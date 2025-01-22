import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DEFAULT_VALUES } from "./constants";
import { CDKBootstrapProduct } from "./cdk-product-stack";

export class ServiceCatalogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Portfolio with tags
    const portfolio = new cdk.aws_servicecatalog.Portfolio(this, "Portfolio", {
      displayName: "YVZ-CCoE-PortFolio",
      providerName: "YVZ-CCOE",
      description:
        "Portfolio with list of Applications created by Cloud Center of Enablement",
      messageLanguage: cdk.aws_servicecatalog.MessageLanguage.EN,
    });

    // Add relevant tags
    cdk.Tags.of(portfolio).add("Environment", "Production");
    cdk.Tags.of(portfolio).add("Owner", "CCOE");

    // Create product using the defined CDKBootstrapProduct class
    const product = new cdk.aws_servicecatalog.CloudFormationProduct(
      this,
      "CDKBootstrap",
      {
        productName: "CDKBootstrap",
        owner: "YVZ-CCOE",
        productVersions: [
          {
            productVersionName: "v1.0",
            validateTemplate: true,
            cloudFormationTemplate:
              cdk.aws_servicecatalog.CloudFormationTemplate.fromProductStack(
                new CDKBootstrapProduct(this, "CDKBootstrapStack")
              ),
            description: "CDKBootstrap is a product that deploys CDKBootstrap",
          },
        ],
        description: "CDKBootstrap is a product that deploys CDKBootstrap",
        distributor: "YVZ-CCOE",
      }
    );

    // Associate product with portfolio
    portfolio.addProduct(product);
    portfolio.giveAccessToRole(
      cdk.aws_iam.Role.fromRoleName(this, "DeveloperRole", "rol-developers")
    );
    portfolio.constrainTagUpdates(product);
    portfolio.setLaunchRole(
      product,
      cdk.aws_iam.Role.fromRoleName(
        this,
        "LaunchRole",
        "LandingZoneServiceCatalogProductConstraintExecutionRole"
      )
    );
  }
}
