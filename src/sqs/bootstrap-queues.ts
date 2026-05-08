import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../config/aws';
import { EventType } from '../types';
import { getDlqName, getQueueName } from './client';

const EVENT_TYPES: EventType[] = ['catalog', 'price', 'stock'];

export async function bootstrapQueuesForAccount(accountName: string): Promise<void> {
  for (const eventType of EVENT_TYPES) {
    await ensureQueueWithDlq(accountName, eventType);
  }
}

async function ensureQueueWithDlq(accountName: string, eventType: EventType): Promise<void> {
  // Create DLQ first
  const dlqName = getDlqName(accountName, eventType);
  const dlqResult = await sqsClient.send(
    new CreateQueueCommand({ QueueName: dlqName })
  );
  const dlqUrl = dlqResult.QueueUrl!;

  // Get DLQ ARN
  const dlqAttrs = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['QueueArn'],
    })
  );
  const dlqArn = dlqAttrs.Attributes?.QueueArn;

  // Create main queue with redrive policy pointing to DLQ
  const queueName = getQueueName(accountName, eventType);
  const queueResult = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: '5',
        }),
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '86400', // 1 day
      },
    })
  );

  console.log(`[SQS] Ensured queue: ${queueName} → DLQ: ${dlqName}`);
}
