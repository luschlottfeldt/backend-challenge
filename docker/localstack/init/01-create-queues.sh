#!/bin/bash
set -euo pipefail

echo "Creating SQS queues in LocalStack..."

create_fifo_with_dlq() {
  local name="$1"
  local dlq_url dlq_arn redrive_policy

  dlq_url=$(awslocal sqs create-queue \
    --queue-name "${name}-dlq.fifo" \
    --attributes FifoQueue=true,ContentBasedDeduplication=false \
    --query 'QueueUrl' --output text)

  dlq_arn=$(awslocal sqs get-queue-attributes \
    --queue-url "$dlq_url" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' --output text)

  redrive_policy=$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"5"}' "$dlq_arn")

  awslocal sqs create-queue \
    --queue-name "${name}.fifo" \
    --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"RedrivePolicy\":\"$(echo "$redrive_policy" | sed 's/"/\\"/g')\"}"
}

create_fifo_with_dlq wager-transactions
create_fifo_with_dlq integration-events

echo "SQS queues created: wager-transactions.fifo, wager-transactions-dlq.fifo, integration-events.fifo, integration-events-dlq.fifo"
