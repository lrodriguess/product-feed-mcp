import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { env } from './env';

const baseConfig = {
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
};

const dynamoBaseClient = new DynamoDBClient({
  ...baseConfig,
  ...(env.DYNAMODB_ENDPOINT ? { endpoint: env.DYNAMODB_ENDPOINT } : {}),
});

export const dynamoClient = DynamoDBDocumentClient.from(dynamoBaseClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const sqsClient = new SQSClient({
  ...baseConfig,
  ...(env.AWS_ENDPOINT ? { endpoint: env.AWS_ENDPOINT } : {}),
});
