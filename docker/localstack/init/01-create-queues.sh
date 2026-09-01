#!/bin/bash
set -euo pipefail

echo "Creating SQS queues in LocalStack..."

DLQ_URL=$(awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false \
  --query 'QueueUrl' --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

REDRIVE_POLICY=$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"5"}' "$DLQ_ARN")

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"RedrivePolicy\":\"$(echo "$REDRIVE_POLICY" | sed 's/"/\\"/g')\"}"

echo "SQS queues created: wager-transactions.fifo, wager-transactions-dlq.fifo"
