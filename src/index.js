"use strict";

const TOPIC_PREFIX = "topic";

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

    const delegate = serverless.variables.getValueFromSource.bind(
      serverless.variables
    );

    serverless.variables.getValueFromSource = variableString => {
      if (variableString.startsWith(`${TOPIC_PREFIX}:`)) {
        const variable = variableString.split(`${TOPIC_PREFIX}:`)[1];
        return this.topics[variable];
      }

      return delegate(variableString);
    };

    this.provider = this.serverless.getProvider("aws");
    this.resources = this.serverless.service.resources;
    this.topics = {};
    this.writeNames();
  }

  logExpose(env) {
    this.serverless.cli.log(`    ✔ Exposing env ${env}`);
  }

  setResourceName(acc, name, type, resource) {
    const { prefix } = (this.serverless.service.custom &&
      this.serverless.service.custom.resourceNames) || {
      prefix: this.serverless.service.service
    };
    const stage = this.serverless.service.provider.stage;

    const envName = convertCase(name).toUpperCase();

    const resoureceName = `${prefix}-${envName.replace(
      /_/g,
      "-"
    )}-${stage}`.toLowerCase();

    const nameConverter = TYPE_TO_PROPERTY_NAME[type];
    if (!nameConverter) {
      throw Error(`Missing nameconverter for ${type}`);
    }
    if (nameConverter instanceof Function) {
      nameConverter(resoureceName, resource.Properties || {});
    } else {
      if (!resource.Properties) {
        resource.Properties = {};
      }
      resource.Properties[nameConverter] = resoureceName;
    }
    this.logExpose(envName);
    if (type === "AWS::SNS::Topic") {
      const arnEnvName = `${envName}_ARN`;
      const arnValue = {
        "Fn::Join": [
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
      acc[arnEnvName] = arnValue;
      this.topics[name] = {
        topicName: resoureceName,
        arn: arnValue
      };
      this.logExpose(arnEnvName);
    }

    acc[envName] = resoureceName;
  }

  writeNames() {
    this.serverless.cli.log(`Applying resource names...`);
    const resouceNamesEnvironment = Object.entries(
      this.resources.Resources
    ).reduce((acc, [key, resource]) => {
      this.setResourceName(acc, key, resource.Type, resource);
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
