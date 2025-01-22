import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// Create interface for variables with strict typing
interface CDKBootstrapStackProps extends cdk.StackProps {
  trustedAccounts?: string[];
  trustedAccountsForLookup?: string[];
  cloudFormationExecutionPolicies?: string[];
  fileAssetsBucketName?: string;
  fileAssetsBucketKmsKeyId?: string;
  containerAssetsRepositoryName?: string;
  qualifier?: string;
  bootstrapVariant?: string;
  loggingBucketName?: string;
  permissionsBoundaryPolicyName?: string;
}

class CDKBootstrapProduct extends cdk.aws_servicecatalog.ProductStack {
  constructor(
    scope: Construct,
    id: string,
    props: CDKBootstrapStackProps = {}
  ) {
    super(scope, id);

    // Use constant values for repeated strings
    const DEFAULT_QUALIFIER = "hnb659fds";
    const DEFAULT_LOGGING_BUCKET = "anwb-nl-s3access-lz";
    const DEFAULT_BOUNDARY_POLICY = "boundarypolicy";
    const AWS_MANAGED_KEY = "AWS_MANAGED_KEY";

    // Initialize CloudFormation Parameters
    const qualifier = new cdk.CfnParameter(this, "Qualifier", {
      type: "String",
      description:
        "An identifier to distinguish multiple bootstrap stacks in the same environment",
      default: DEFAULT_QUALIFIER,
    }).valueAsString;

    // Destructure props with defaults
    const {
      loggingBucketName = DEFAULT_LOGGING_BUCKET,
      permissionsBoundaryPolicyName = DEFAULT_BOUNDARY_POLICY,
      fileAssetsBucketKmsKeyId,
    } = props;

    // Create KMS key if no existing key is provided
    const createNewKey = !props.fileAssetsBucketKmsKeyId;
    const useAwsManagedKey =
      props.fileAssetsBucketKmsKeyId === "AWS_MANAGED_KEY";

    let encryptionKey: cdk.aws_kms.IKey | undefined;

    if (createNewKey) {
      encryptionKey = new cdk.aws_kms.Key(this, "FileAssetsBucketKey", {
        enableKeyRotation: true,
        alias: `alias/cdk-${qualifier}-assets-key`,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        description: "KMS key for CDK assets bucket encryption",
        policy: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              actions: ["kms:*"],
              principals: [new cdk.aws_iam.AccountRootPrincipal()],
              resources: ["*"],
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "kms:Encrypt*",
                "kms:Decrypt*",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
                "kms:Describe*",
              ],
              resources: ["*"],
              principals: [new cdk.aws_iam.AnyPrincipal()],
              conditions: {
                StringEquals: {
                  "kms:CallerAccount": this.account,
                  "kms:ViaService": `s3.${this.region}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
      });
    } else if (props.fileAssetsBucketKmsKeyId === "AWS_MANAGED_KEY") {
      encryptionKey = cdk.aws_kms.Key.fromLookup(this, "ImportedKey", {
        aliasName: "aws/s3",
      });
    } else {
      encryptionKey = cdk.aws_kms.Key.fromKeyArn(
        this,
        "FileAssetsBucketKey",
        props.fileAssetsBucketKmsKeyId!
      );
    }

    // Create S3 Bucket with security best practices
    const stagingBucket = new cdk.aws_s3.Bucket(this, "CDKBucket", {
      bucketName:
        props.fileAssetsBucketName ||
        `cdk-${qualifier}-assets-${this.account}-${this.region}`,
      encryption: useAwsManagedKey
        ? cdk.aws_s3.BucketEncryption.S3_MANAGED
        : createNewKey
        ? cdk.aws_s3.BucketEncryption.KMS
        : cdk.aws_s3.BucketEncryption.KMS,
      encryptionKey: createNewKey ? encryptionKey : undefined,
      serverAccessLogsPrefix: "cdk-assets-bucket-logs",
      serverAccessLogsBucket: cdk.aws_s3.Bucket.fromBucketName(
        this,
        "LoggingBucket",
        `${loggingBucketName}-${this.account}-${this.region}`
      ),
      versioned: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
      ],
    });

    // Create ECR Repository
    const ecrRepository = new cdk.aws_ecr.Repository(
      this,
      "ContainerAssetsRepository",
      {
        repositoryName:
          props.containerAssetsRepositoryName ||
          `cdk-${qualifier}-assets-${this.account}-${this.region}`,
        imageTagMutability: cdk.aws_ecr.TagMutability.IMMUTABLE,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        imageScanOnPush: true,
        lifecycleRules: [
          {
            maxImageAge: cdk.Duration.days(365),
            tagStatus: cdk.aws_ecr.TagStatus.UNTAGGED,
          },
        ],
      }
    );

    // Add repository policy for Lambda
    ecrRepository.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "LambdaECRImageRetrievalPolicy",
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.ServicePrincipal("lambda.amazonaws.com")],
        actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        conditions: {
          StringLike: {
            "aws:sourceArn": `arn:${this.partition}:lambda:${this.region}:${this.account}:function:*`,
          },
        },
      })
    );
    // Import Permissionboundary
    const permissionBounderyPolicy =
      cdk.aws_iam.ManagedPolicy.fromManagedPolicyName(
        this,
        "PermissionsBoundary",
        permissionsBoundaryPolicyName
      );

    // Create File Publishing Role
    const filePublishingRole = new cdk.aws_iam.Role(
      this,
      "FilePublishingRole",
      {
        roleName: `cdk-${qualifier}-file-publishing-role-${this.account}-${this.region}`,
        permissionsBoundary: permissionBounderyPolicy,
        assumedBy: new cdk.aws_iam.CompositePrincipal(
          new cdk.aws_iam.AccountPrincipal(this.account),
          ...(props.trustedAccounts || []).map(
            (acc) => new cdk.aws_iam.AccountPrincipal(acc)
          )
        ),
      }
    );

    // Create Image Publishing Role
    const imagePublishRole = new cdk.aws_iam.Role(this, "ImagePublishingRole", {
      roleName: `cdk-${qualifier}-image-publishing-role-${this.account}-${this.region}`,
      permissionsBoundary: permissionBounderyPolicy,
      assumedBy: new cdk.aws_iam.CompositePrincipal(
        new cdk.aws_iam.AccountPrincipal(this.account),
        ...(props.trustedAccounts || []).map(
          (acc) => new cdk.aws_iam.AccountPrincipal(acc)
        )
      ),
    });

    // Create Lookup Role
    const lookupRole = new cdk.aws_iam.Role(this, "LookupRole", {
      roleName: `cdk-${qualifier}-lookup-role-${this.account}-${this.region}`,
      permissionsBoundary: permissionBounderyPolicy,
      assumedBy: new cdk.aws_iam.CompositePrincipal(
        new cdk.aws_iam.AccountPrincipal(this.account),
        ...(props.trustedAccountsForLookup || []).map(
          (acc) => new cdk.aws_iam.AccountPrincipal(acc)
        )
      ),
      inlinePolicies: {
        DontReadSecrets: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.DENY,
              actions: ["kms:Decrypt"],
              resources: ["*"],
            }),
          ],
        }),
      },
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess"),
      ],
    });
    // Create Default Policy for FilePublishingRole
    const filePublishingRoleDefaultPolicy = new cdk.aws_iam.Policy(
      this,
      "FilePublishingRoleDefaultPolicy",
      {
        policyName: `cdk-${qualifier}-file-publishing-role-default-policy-${this.account}-${this.region}`,
        roles: [filePublishingRole],
        document: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "s3:GetObject*",
                "s3:GetBucket*",
                "s3:GetEncryptionConfiguration",
                "s3:List*",
                "s3:DeleteObject*",
                "s3:PutObject",
                "s3:Abort*",
              ],
              resources: [
                stagingBucket.bucketArn,
                `${stagingBucket.bucketArn}/*`,
              ],
              conditions: {
                StringEquals: {
                  "aws:ResourceAccount": this.account,
                },
              },
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              resources: [encryptionKey.keyArn],
              // resources: [encryptionKey?.keyArn || '*'].filter(Boolean)
            }),
          ],
        }),
      }
    );

    // Create Image Publishing Role Default Policy
    const imagePublishingRoleDefaultPolicy = new cdk.aws_iam.Policy(
      this,
      "ImagePublishingRoleDefaultPolicy",
      {
        policyName: `cdk-${qualifier}-image-publishing-role-default-policy-${this.account}-${this.region}`,
        roles: [imagePublishRole],
        document: new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "ecr:PutImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:BatchCheckLayerAvailability",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
              ],
              resources: [ecrRepository.repositoryArn],
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"],
            }),
          ],
        }),
      }
    );

    // Create Deployment Action Role
    const deploymentActionRole = new cdk.aws_iam.Role(
      this,
      "DeploymentActionRole",
      {
        roleName: `cdk-${qualifier}-deployment-action-role-${this.account}-${this.region}`,
        permissionsBoundary: permissionBounderyPolicy,
        assumedBy: new cdk.aws_iam.ServicePrincipal(
          "cloudformation.amazonaws.com"
        ),
        inlinePolicies: {
          PassRoles: new cdk.aws_iam.PolicyDocument({
            statements: [
              new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [
                  filePublishingRole.roleArn,
                  imagePublishRole.roleArn,
                  lookupRole.roleArn,
                ],
              }),
            ],
          }),
        },
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole"
          ),
        ],
      }
    );
    // Add CloudFormation execution policies if provided
    if (props.cloudFormationExecutionPolicies) {
      props.cloudFormationExecutionPolicies.forEach((policyArn, index) => {
        deploymentActionRole.addManagedPolicy(
          cdk.aws_iam.ManagedPolicy.fromManagedPolicyArn(
            this,
            `CloudFormationExecutionPolicy${index}`,
            policyArn
          )
        );
      });
    }

    // Add outputs
    new cdk.CfnOutput(this, "FilePublishingRoleArn", {
      value: filePublishingRole.roleArn,
      description: "The ARN of the file publishing role",
    });

    new cdk.CfnOutput(this, "ImagePublishingRoleArn", {
      value: imagePublishRole.roleArn,
      description: "The ARN of the image publishing role",
    });

    new cdk.CfnOutput(this, "LookupRoleArn", {
      value: lookupRole.roleArn,
      description: "The ARN of the lookup role",
    });

    new cdk.CfnOutput(this, "DeploymentActionRoleArn", {
      value: deploymentActionRole.roleArn,
      description: "The ARN of the deployment action role",
    });

    // Add stack tags
    cdk.Tags.of(this).add(
      "BootstrapVariant",
      props.bootstrapVariant || "AWS CDK: Default Resources"
    );
  }
}

export class ServiceCatalogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Portfolio with tags
    const portfolio = new cdk.aws_servicecatalog.Portfolio(this, "Portfolio", {
      displayName: "CCoE-PortFolio",
      providerName: "CCOE",
      description:
        "Portfolio with list of Applications created by Cloud Center of Enablement",
      messageLanguage: cdk.aws_servicecatalog.MessageLanguage.EN,
    });

    // Add relevant tags
    cdk.Tags.of(portfolio).add("Environment", "Production");
    cdk.Tags.of(portfolio).add("Owner", "CCOE");

    // Create product using the defined CDKBootstrapProduct class
    const cdkBootstrap = new cdk.aws_servicecatalog.CloudFormationProduct(
      this,
      "CDKBootstrap",
      {
        productName: "CDKBootstrap",
        owner: "CCOE",
        productVersions: [
          {
            productVersionName: "v1.0",
            cloudFormationTemplate:
              cdk.aws_servicecatalog.CloudFormationTemplate.fromProductStack(
                new CDKBootstrapProduct(this, "CDKBootstrapStack")
              ),
            description: "CDKBootstrap is a product that deploys CDKBootstrap",
          },
        ],
        description: "CDKBootstrap is a product that deploys CDKBootstrap",
        distributor: "CCOE",
      }
    );

    // Associate product with portfolio
    portfolio.addProduct(cdkBootstrap);

    // Optional: Add launch constraints if needed
    // portfolio.setLaunchRole(cdkBootstrap, new cdk.aws_iam.Role(...));
  }
}
