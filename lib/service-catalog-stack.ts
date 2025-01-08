import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

class CDKBootstrapProduct extends cdk.aws_servicecatalog.ProductStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const bucketKey = new cdk.aws_kms.Key(this, 'FileAssetsBucketKey', {
      enableKeyRotation: true,
      alias: 'cdk-assets-key'
    })
    
    new cdk.aws_s3.Bucket(this, 'StagingBucket', {
      encryption: bucketKey,
      
    })
  }
}
export class ServiceCatalogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const portfolio = new cdk.aws_servicecatalog.Portfolio(this, 'Portfolio', {
      displayName: 'CCoE-PortFolio',
      providerName: 'CCOE',
      description: 'Portfolio with list of Applications created by Cloud Center of Enablement',	
      messageLanguage: cdk.aws_servicecatalog.MessageLanguage.EN
    });

    const cdkBootstrap = new cdk.aws_servicecatalog.CloudFormationProduct(this, 'CDKBootstrap', {
      productName: 'CDKBootstrap',
      owner: 'CCOE',
      productVersions: [
        {
          productVersionName: 'v1.0',
          cloudFormationTemplate: cdk.aws_servicecatalog.CloudFormationTemplate.fromProductStack(new cdk.aws_servicecatalog.ProductStack(this, 'CDKBootstrapStack')),
          description: 'CDKBootstrap is a product that deploys CDKBootstrap'
        }
      ],
      description: 'CDKBootstrap is a product that deploys CDKBootstrap',
      distributor: 'CCOE',
    });
  }
}
