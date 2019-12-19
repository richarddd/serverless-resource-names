"use strict";

const TYPE_TO_PROPERTY_NAME = {
  "AWS::SQS::Queue": "QueueName",
  "AWS::S3::Bucket": "BucketName",
  "AWS::SNS::Topic": "TopicName",
  "AWS::DocDB::DBCluster": "DBClusterIdentifier",
  "AWS::DynamoDB::Table": "TableName",
  "AWS::DocDB::DBInstance": "DBInstanceIdentifier",
  "AWS::EC2::Instance": (name, properties) => {
    const existingTags = properties.Tags || [];
    for (const tag of existingTags) {
      if (tag.Key === "Name") {
        return;
      }
    }
    properties.Tags = [{ Key: "Name", Value: name }, ...existingTags];
  }
};

const convertCase = (text, separator = "_") => {
  const isCapital = char => char.charCodeAt() >= 65 && char.charCodeAt() <= 90;
  return text
    .replace(/[\w]([A-Z])/g, m => {
      if (isCapital(m[0]) && isCapital(m[1])) {
        return `${m[0]}${m[1]}${separator}`;
      }
      return `${m[0]}${separator}${m[1]}`;
    })
    .toLowerCase();
};

class ResourceNamePlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.provider = this.serverless.getProvider("aws");

    this.hooks = {
      "before:offline:start:init": this.writeNames.bind(this),
      "before:aws:common:validate:validate": this.writeNames.bind(this)
    };
  }

  setResourceName(acc, name, type, properties) {
    const { prefix } = this.serverless.service.custom.resourceNames || {
      prefix: this.serverless.service.name
    };
    const stage = this.serverless.service.provider.stage;

    const envName = convertCase(name).toUpperCase();

    this.serverless.cli.log(`    ✔ Exposing env ${envName}`);

    const resoureceName = `${prefix}-${envName.replace(
      /_/g,
      "-"
    )}-${stage}`.toLowerCase();

    const nameConverter = TYPE_TO_PROPERTY_NAME[type];
    if (!nameConverter) {
      throw Error(`Missing nameconverter for ${type}`);
    }
    if (nameConverter instanceof Function) {
      nameConverter(resoureceName, properties);
    } else {
      properties[nameConverter] = resoureceName;
    }
    if (type === "AWS::SNS::Topic") {
      acc[`${envName}_ARN`] = {
        ["Fn::Join"]: [
          ":",
          [
            "arn",
            "aws",
            "sns",
            { Ref: "AWS::Region" },
            { Ref: "AWS::AccountId" },
            resoureceName
          ]
        ]
      };
    }
    acc[envName] = resoureceName;
  }

  writeNames() {
    this.serverless.cli.log(`Applying resource names...`);
    const resouceNamesEnvironment = Object.entries(
      this.serverless.service.resources.Resources
    ).reduce((acc, [key, resource]) => {
      this.setResourceName(acc, key, resource.Type, resource.Properties);
      return acc;
    }, {});
    Object.entries(this.serverless.service.functions).forEach(
      ([name, func]) => {
        func.environment = { ...func.environment, ...resouceNamesEnvironment };
      }
    );
  }
}
module.exports = ResourceNamePlugin;
