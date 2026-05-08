import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../config/aws';
import { getQueueUrl } from './client';
import { listActiveChannelConfigsByAccount } from '../channels/channel-config.repository';
import { runPipeline } from '../pipeline/orchestrator';
import { QueueMessage, EventType } from '../types';
import { RetryableError } from '../pipeline/errors';

const EVENT_TYPES: EventType[] = ['catalog', 'price', 'stock'];
const POLL_INTERVAL_MS = 1000;

let running = false;

export async function startConsumers(accountNames: string[]): Promise<void> {
  running = true;
  console.log(`[SQS] Starting consumers for accounts: ${accountNames.join(', ')}`);

  const consumers: Promise<void>[] = [];
  for (const accountName of accountNames) {
    for (const eventType of EVENT_TYPES) {
      consumers.push(consumeQueue(accountName, eventType));
    }
  }

  await Promise.all(consumers);
}

export function stopConsumers(): void {
  running = false;
  console.log('[SQS] Stopping consumers...');
}

async function consumeQueue(accountName: string, eventType: EventType): Promise<void> {
  let queueUrl: string;
  try {
    queueUrl = await getQueueUrl(accountName, eventType);
  } catch {
    console.warn(`[SQS] Queue not found for ${accountName}/${eventType}, skipping`);
    return;
  }

  console.log(`[SQS] Polling: ${queueUrl}`);

  while (running) {
    try {
      const result = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20, // long polling
        })
      );

      for (const sqsMsg of result.Messages ?? []) {
        const body = JSON.parse(sqsMsg.Body ?? '{}') as QueueMessage;
        try {
          await runPipeline(body);
          // Ack on success
          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: sqsMsg.ReceiptHandle!,
            })
          );
        } catch (err) {
          if (err instanceof RetryableError) {
            // Extend visibility timeout to allow backoff
            await sqsClient.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: sqsMsg.ReceiptHandle!,
                VisibilityTimeout: 30,
              })
            ).catch(() => {});
          } else {
            console.error(`[SQS] Unhandled error for message ${sqsMsg.MessageId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`[SQS] Poll error for ${accountName}/${eventType}:`, err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
