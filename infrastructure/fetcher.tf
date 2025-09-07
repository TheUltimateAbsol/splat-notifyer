data "archive_file" "data_fetcher_lambda_archive" {
  type        = "zip"
  source_file = "./files/data_fetcher.py"
  output_path = "./.build/data_fetcher.zip"
}

resource "aws_s3_bucket" "splat_notifyer_data_cache" {
  bucket = "splat-notifyer-${var.base_domain}-data-cache"
  tags = {
    Name        = "splat-notifyer-data-cache"
    Environment = "production"
  }
}

resource "aws_s3_bucket_public_access_block" "splat_notifyer_data_cache_public_access_block" {
  bucket = aws_s3_bucket.splat_notifyer_data_cache.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_lambda_function" "data_fetcher_lambda" {
  function_name    = "splat-notifyer-data-fetcher"
  handler          = "data_fetcher.handler"
  runtime          = "python3.10"
  role             = aws_iam_role.lambda_exec_role.arn
  filename         = "./.build/data_fetcher.zip"
  timeout = 15
  source_code_hash = data.archive_file.data_fetcher_lambda_archive.output_base64sha256
  environment {
    variables = {
      S3_BUCKET_NAME = aws_s3_bucket.splat_notifyer_data_cache.bucket
    }
  }
}

resource "aws_apigatewayv2_integration" "data_fetcher_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.data_fetcher_lambda.invoke_arn
}

resource "aws_cloudwatch_event_rule" "data_fetcher_schedule_rule" {
  name        = "splat-notifyer-data-fetcher-schedule-rule"
  description = "Triggers data_fetcher_lambda every even hour 5 minutes past the hour (UTC)"
  schedule_expression = "cron(5 */2 * * ? *)" # 5 minutes past every even hour UTC
}

resource "aws_cloudwatch_event_target" "data_fetcher_target" {
  rule      = aws_cloudwatch_event_rule.data_fetcher_schedule_rule.name
  arn       = aws_lambda_function.data_fetcher_lambda.arn
  input     = jsonencode({}) # Empty input for scheduled trigger
}

resource "aws_lambda_permission" "allow_eventbridge_data_fetcher" {
  statement_id  = "AllowEventBridgeInvokeDataFetcher"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_fetcher_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.data_fetcher_schedule_rule.arn
}

resource "aws_lambda_invocation" "initial_fetch" {
  function_name = aws_lambda_function.data_fetcher_lambda.function_name

  # Re-invoke when function environment changes
  triggers = {
    config_hash = data.archive_file.data_fetcher_lambda_archive.output_base64sha256
  }

    input = jsonencode({})
}