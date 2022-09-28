"use strict";

const TOPIC_PREFIX = "topic";
const NAME_PREFIX = "name";

const setPath = (object, path, value) => {
  const parts = path.split(".");
  while (parts.length > 1 && object.hasOwnProperty(parts[0])) {
    object = object[parts.shift()];
  }
  object[parts[0]] = value;
};

const getPath = (object, path, defaultValue) =>
  path
    .split(/[\.\[\]\'\"]/)
    .filter((p) => p)
    .reduce((o, p) => (o ? o[p] : defaultValue), object);

const nameTag = (name, properties) => {
  const existingTags = properties.Tags || [];
  for (const tag of existingTags) {
    if (tag.Key === "Name") {
      return tag.value;
    }
  }
  properties.Tags = [{ Key: "Name", Value: name }, ...existingTags];
  return name;
};

const nestedName = (path) => (name, properties) => {
  const existingName = getPath(properties, path);
  if (existingName) {
    return existingName;
  }
  setPath(properties, path, name);
  return name;
};

const TYPE_TO_PROPERTY_NAME = {
  "AWS::IAM::Policy": "PolicyName",
  "AWS::IAM::Role": "RoleName",
  "AWS::SQS::Queue": "QueueName",
  "AWS::S3::Bucket": "BucketName",
  "AWS::SNS::Topic": "TopicName",
  "AWS::Lambda::Function": "FunctionName",
  "AWS::DocDB::DBCluster": "DBClusterIdentifier",
  "AWS::DynamoDB::Table": "TableName",
  "AWS::DocDB::DBInstance": "DBInstanceIdentifier",
  "AWS::CloudFront::CachePolicy": nestedName("CachePolicyConfig.Name"),
  "AWS::EC2::Instance": nameTag,
  "AWS::EC2::VPC": nameTag,
  "AWS::EC2::Subnet": nameTag,
  "AWS::EC2::EIP": nameTag,
  "AWS::EC2::NatGateway": nameTag,
  "AWS::EC2::RouteTable": nameTag,
};

const convertCase = (text, separator = "_") => {
  const isCapital = (char) =>
    char.charCodeAt() >= 65 && char.charCodeAt() <= 90;
  return text
    .replace(/[\w]([A-Z])/g, (m) => {
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
    this.service = serverless.service;
    this.options = options;
    this.provider = serverless.getProvider("aws");
    this.topics = {};
    this.names = {};
    this.environmentVariables = {};
    this.injected = false;
    this.injectedResources = {};

    const that = this;

    this.configurationVariablesSources = {
      [TOPIC_PREFIX]: {
        async resolve({ address }) {
          const value = await that.getTopicValue(address);
          return {
            value,
          };
        },
      },
      [NAME_PREFIX]: {
        async resolve({ address }) {
          const value = await that.getNameValue(address);
          return {
            value,
          };
        },
      },
    };

    this.commands = {
      env: {
        usage: "Prints all environment variables",
        lifecycleEvents: ["environment"],
      },
    };

    this.hooks = {
      "env:environment": this.printEnvironment.bind(this),
      "before:offline:start:init": this.injectVariables.bind(this),
      "before:aws:common:validate:validate": this.injectVariables.bind(this),
    };
  }

  async getNameValue(variable) {
    await this.writeResourceNames();
    const value = this.names[variable];
    if (!value) {
      throw new this.serverless.classes.Error(
        `Can not find injected resource with logical id: ${variable}`
      );
    }
    return value;
  }

  async getTopicValue(variable) {
    const [topic, property] = variable.split(".");

    await this.writeResourceNames();

    if (!this.topics[topic]) {
      throw new this.serverless.classes.Error(
        `Can not find topic with resource name: ${topic}`
      );
    }

    const value =
      (!property && this.topics[topic]) ||
      (this.topics[topic] && this.topics[topic][property]);
    if (!this.topics[topic]) {
      throw new this.serverless.classes.Error(
        `Can not find topic with resource name: ${topic}`
      );
    }

    return value;
  }

  async printEnvironment() {
    await this.writeResourceNames();

    Object.entries(this.service.provider.environment).forEach(
      ([key, value]) => {
        let printValue = `"${value}"`;
        if (typeof value === "number" || typeof value === "boolean") {
          printValue = value;
        } else if (typeof value === "object") {
          printValue = JSON.stringify(JSON.stringify(value));
        }
        this.serverless.cli.consoleLog(`${key}=${printValue}`);
      }
    );
  }

  async injectVariables() {
    await this.writeResourceNames();
    if (!this.injected) {
      this.injected = true;
      this.serverless.cli.log(`Applying resource names...`);
      Object.entries(this.environmentVariables).forEach(([key]) => {
        this.serverless.cli.log(`    ✔ Exposing env ${key}`);
      });
    }
  }

  setResourceName(acc, logicalId, type, resource, stage) {
    const { prefix } = (this.service.custom &&
      this.service.custom.resourceNames) || {
      prefix: this.service.service,
    };

    const envName = convertCase(logicalId).toUpperCase();

    let resourceName = `${prefix}-${envName.replace(
      /_/g,
      "-"
    )}-${stage}`.toLowerCase();

    const nameConverter = TYPE_TO_PROPERTY_NAME[type];
    if (!nameConverter) {
      return;
    }
    if (nameConverter instanceof Function) {
      resourceName = nameConverter(resourceName, resource.Properties || {});
    } else {
      if (!resource.Properties) {
        resource.Properties = {};
      }
      if (resource.Properties[nameConverter]) {
        resourceName = resource.Properties[nameConverter];
      } else {
        resource.Properties[nameConverter] = resourceName;
      }
    }

    const addArn = (value) => {
      acc[`${envName}_ARN`] =
        (!process.env.IS_OFFLINE && value) || JSON.stringify(value);
    };

    if (type === "AWS::SQS::Queue") {
      addArn({
        "Fn::GetAtt": [logicalId, "Arn"],
      });
      const ref = { Ref: logicalId };
      acc[`${envName}_URL`] =
        (!process.env.IS_OFFLINE && ref) || JSON.stringify(ref);
      if (
        resource.Properties &&
        resource.Properties.FifoQueue &&
        !resourceName.endsWith(".fifo")
      ) {
        resourceName += ".fifo";
        resource.Properties[nameConverter] = resourceName;
      }
    } else if (type === "AWS::SNS::Topic") {
      const arnValue = {
        "Fn::Join": [
          ":",
          [
            "arn",
            "aws",
            "sns",
            { Ref: "AWS::Region" },
            { Ref: "AWS::AccountId" },
            resourceName,
          ],
        ],
      };
      addArn(arnValue);
      this.topics[logicalId] = {
        topicName: resourceName,
        arn: arnValue,
      };
    }
    this.names[logicalId] = resourceName;
    acc[envName] = resourceName;
  }

  async writeName(resources) {
    return Object.entries(resources.Resources).reduce(
      (acc, [logicalId, resource]) => {
        this.setResourceName(
          acc,
          logicalId,
          resource.Type,
          resource,
          this.service.provider.stage
        );
        return acc;
      },
      {}
    );
  }

  async writeResourceNames() {
    if (!this.injected && this.serverless.service.resources) {
      if (Array.isArray(this.serverless.service.resources)) {
        for (const resource of this.serverless.service.resources) {
          this.environmentVariables = {
            ...this.environmentVariables,
            ...(await this.writeName(resource)),
          };
        }
      } else {
        this.environmentVariables = await this.writeName(
          this.serverless.service.resources
        );
      }

      this.service.provider.environment = {
        ...this.service.provider.environment,
        ...this.environmentVariables,
      };
    }
  }
}
module.exports = ResourceNamePlugin;
