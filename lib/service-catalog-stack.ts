import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DEFAULT_VALUES } from "./constants";
import { CDKBootstrapProduct } from "./cdk-product-stack";

import { IPortfolioProps, IProductConfig } from "./types";
import { validateProductConfig } from "./utils/validation";
import { addStandardTags } from "./utils/portfolio";
import { handleAsyncError } from "./utils/error-handler";

/**
 * ServiceCatalogStack represents the main stack for AWS Service Catalog configuration
 * @extends cdk.Stack
 */
/**
 * Error thrown when portfolio creation fails
 */
class PortfolioError extends Error {
  constructor(message: string) {
    super(`Portfolio Error: ${message}`);
    this.name = 'PortfolioError';
  }
}

export class ServiceCatalogStack extends cdk.Stack {
  private pendingProduct?: { product: cdk.aws_servicecatalog.CloudFormationProduct; productName: string };
  private readonly portfolio: cdk.aws_servicecatalog.Portfolio;
  private readonly products: Map<string, cdk.aws_servicecatalog.CloudFormationProduct> = new Map();

  /**
   * Get a product by its name
   * @param name The name of the product
   * @returns The CloudFormation product
   * @throws PortfolioError if product not found
   */
  public getProduct(name: string): cdk.aws_servicecatalog.CloudFormationProduct {
    const product = this.products.get(name);
    if (!product) {
      throw new PortfolioError(`Product ${name} not found`);
    }
    return product;
  }

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Portfolio with tags
    const portfolioProps: IPortfolioProps = {
      displayName: "YVZ-CCoE-PortFolio",
      providerName: "YVZ-CCOE",
      description: "Portfolio with list of Applications created by Cloud Center of Enablement",
      messageLanguage: cdk.aws_servicecatalog.MessageLanguage.EN,
    };
    
    this.portfolio = new cdk.aws_servicecatalog.Portfolio(this, "Portfolio", portfolioProps);

    // Add standard tags using utility function
    addStandardTags(this.portfolio);

    // Create product using the defined CDKBootstrapProduct class
    const productConfig: IProductConfig = {
        productName: "CDKBootstrap",
        owner: "YVZ-CCOE",
        description: "CDK Bootstrap configuration for AWS accounts",
        distributor: "Cloud Center of Excellence",
        supportEmail: "ccoe@example.com",
        supportDescription: "Contact Cloud Center of Excellence for support"
    };

    // Validate product configuration
validateProductConfig(productConfig);

const product: cdk.aws_servicecatalog.CloudFormationProduct = new cdk.aws_servicecatalog.CloudFormationProduct(
      this,
      "CDKBootstrap",
      {
        ...productConfig,
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

    // Configure the product in the portfolio
    this.portfolio.addProduct(product);
    this.products.set(productConfig.productName, product);
    this.portfolio.giveAccessToRole(
      cdk.aws_iam.Role.fromRoleName(this, "DeveloperRole", "rol-developers")
    );
    this.portfolio.constrainTagUpdates(product);
    this.portfolio.setLaunchRole(
      product,
      cdk.aws_iam.Role.fromRoleName(
        this,
        "LaunchRole",
        "LandingZoneServiceCatalogProductConstraintExecutionRole"
      )
    );
  }
}
