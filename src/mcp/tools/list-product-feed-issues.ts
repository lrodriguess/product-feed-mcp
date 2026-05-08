import { z } from 'zod';
import { listIssuesByChannel } from '../../store/offer-issue';
import { IssueType, IssueSeverity } from '../../types';

export const listProductFeedIssuesSchema = z.object({
  channelId: z.string(),
  accountName: z.string(),
  issueType: z.string().optional() as z.ZodOptional<z.ZodType<IssueType>>,
  severity: z.enum(['error', 'warning', 'info']).optional() as z.ZodOptional<z.ZodType<IssueSeverity>>,
  skuId: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ListProductFeedIssuesInput = z.infer<typeof listProductFeedIssuesSchema>;

export async function handleListProductFeedIssues(input: ListProductFeedIssuesInput): Promise<unknown> {
  const { channelId, accountName, issueType, severity, skuId, limit, cursor } = input;

  const result = await listIssuesByChannel(accountName, channelId, {
    issueType,
    severity,
    skuId,
    limit,
    cursor,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            issues: result.issues,
            total: result.issues.length,
            nextCursor: result.nextCursor,
          },
          null,
          2
        ),
      },
    ],
  };
}
