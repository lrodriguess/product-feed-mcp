import {
  SendMessageCommand,
  GetQueueUrlCommand,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../config/aws';
import { env } from '../config/env';
import { EventType } from '../types';

export function getQueueName(accountName: string, eventType: EventType): string {
  return `vtex-feed-${accountName}-${eventType}`;
}

export function getDlqName(accountName: string, eventType: EventType): string {
  return `vtex-feed-${accountName}-${eventType}-dlq`;
}

export async function getQueueUrl(accountName: string, eventType: EventType): Promise<string> {
  const queueName = getQueueName(accountName, eventType);
  const result = await sqsClient.send(
    new GetQueueUrlCommand({ QueueName: queueName })
  );
  if (!result.QueueUrl) {
    throw new Error(`Queue not found: ${queueName}`);
  }
  return result.QueueUrl;
}

export async function enqueue(
  accountName: string,
  eventType: EventType,
  body: unknown
): Promise<void> {
  const queueUrl = await getQueueUrl(accountName, eventType);
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
    })
  );
}

export const SQS_QUEUE_PREFIX = `vtex-feed`;
