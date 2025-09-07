provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# IAM Role for Lambda Functions
resource "aws_iam_role" "lambda_exec_role" {
  name = "splat-notifyer-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Effect = "Allow",
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "lambda_dynamodb_eventbridge_s3_policy" {
  name = "splat-notifyer-lambda-dynamodb-eventbridge-s3-policy"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "scheduler:CreateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
          "scheduler:UpdateSchedule",
          "iam:PassRole",
          "s3:PutObject",
          "s3:GetObject*", # Added S3 GetObject permission
          "s3:ListBucket" # Added S3 GetObject permission
        ],
        Effect = "Allow",
        Resource = [
          aws_dynamodb_table.webhooks_table.arn,
          "${aws_dynamodb_table.webhooks_table.arn}/*",
          aws_scheduler_schedule_group.user_schedules_group.arn,
          "${aws_scheduler_schedule_group.user_schedules_group.arn}/*",
          "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.user_schedules_group.name}/*",
          "${aws_s3_bucket.splat_notifyer_data_cache.arn}/*", # Added S3 resource for data.json
          "${aws_s3_bucket.splat_notifyer_data_cache.arn}", # Added S3 resource for data.json
          aws_iam_role.eventbridge_scheduler_role.arn
        ]
      }
    ]
  })
}


resource "aws_iam_role_policy_attachment" "lambda_dynamodb_eventbridge_s3_attachment" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = aws_iam_policy.lambda_dynamodb_eventbridge_s3_policy.arn
}

# DynamoDB Table for Webhooks
resource "aws_iam_role" "eventbridge_scheduler_role" {
  name = "splat-notifyer-eventbridge-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Effect = "Allow",
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "eventbridge_scheduler_invoke_lambda_policy" {
  name = "splat-notifyer-eventbridge-scheduler-invoke-lambda-policy"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action   = "lambda:InvokeFunction",
        Effect   = "Allow",
        Resource = aws_lambda_function.notifyer_update_lambda.arn # Grant permission to invoke the notifyer_update_lambda
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eventbridge_scheduler_invoke_lambda_attachment" {
  role       = aws_iam_role.eventbridge_scheduler_role.name
  policy_arn = aws_iam_policy.eventbridge_scheduler_invoke_lambda_policy.arn
}


resource "aws_dynamodb_table" "webhooks_table" {
  name         = "splat-notifyer-webhooks"
  billing_mode = "PAY_PER_REQUEST" # Or provisioned mode with read/write capacity

  hash_key = "webhook_url"

  attribute {
    name = "webhook_url"
    type = "S" # String
  }

  tags = {
    Environment = "development" # Or desired environment
    Project     = "splat-notifyer"
  }
}

# Lambda Functions (excluding data_fetcher_lambda)
resource "aws_lambda_function" "api_gateway_lambda" {
  function_name    = "splat-notifyer-api-gateway"
  handler          = "api.handler"
  runtime          = "python3.10" # Or desired Python version
  role             = aws_iam_role.lambda_exec_role.arn
  filename         = data.archive_file.api_lambda_archive.output_path
  source_code_hash = data.archive_file.api_lambda_archive.output_base64sha256
  environment {
    variables = {
      S3_BUCKET_NAME             = aws_s3_bucket.splat_notifyer_data_cache.bucket
      EVENTBRIDGE_SCHEDULE_GROUP_NAME = aws_scheduler_schedule_group.user_schedules_group.name
      DYNAMODB_TABLE_NAME         = aws_dynamodb_table.webhooks_table.name
      DESTINATION_LAMBDA_ARN     = aws_lambda_function.notifyer_update_lambda.arn
      EVENTBRIDGE_ROLE_ARN       = aws_iam_role.eventbridge_scheduler_role.arn
    }
  }
}

resource "aws_lambda_function" "notifyer_update_lambda" {
  function_name    = "splat-notifyer-update"
  handler          = "api.lambda_handler"
  runtime          = "python3.10"
  role             = aws_iam_role.lambda_exec_role.arn
  filename         = data.archive_file.api_lambda_archive.output_path
  source_code_hash = data.archive_file.api_lambda_archive.output_base64sha256
  environment {
    variables = {
      S3_BUCKET_NAME = aws_s3_bucket.splat_notifyer_data_cache.bucket
    }
  }
}

# EventBridge Schedule Group
resource "aws_scheduler_schedule_group" "user_schedules_group" {
  name = "user-schedules"
  tags = {
    Environment = "development" # Or desired environment
    Project     = "splat-notifyer"
  }
}

# Archive files for Lambda functions
data "archive_file" "api_lambda_archive" {
  type        = "zip"
  source_file = "./files/api.py"
  output_path = "./.build/api_lambda.zip"
}

# ACM Certificate for API Gateway Custom Domain
resource "aws_acm_certificate" "api_gateway_cert" {
  domain_name       = "${var.api_hostname}.${var.base_domain}"
  validation_method = "DNS"
}

# ACM Certificate Validation
resource "aws_acm_certificate_validation" "api_gateway_cert_validation" {
  certificate_arn         = aws_acm_certificate.api_gateway_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.api_gateway_cert_validation : record.fqdn]
}

# API Gateway (HTTP V2)
resource "aws_apigatewayv2_api" "http_api" {
  name          = "splat-notifyer-http-api"
  protocol_type = "HTTP" # This creates an HTTP API (v2)

  cors_configuration {
    allow_origins = ["http://localhost:8080", "https://splat-notifyer.splatpass.net"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
}

# API Gateway Custom Domain Name
resource "aws_apigatewayv2_domain_name" "api_gateway_domain_name" {
  domain_name = "${var.api_hostname}.${var.base_domain}"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api_gateway_cert.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

# API Gateway Stage
resource "aws_apigatewayv2_stage" "api_gateway_stage" {
  name        = "$default"
  api_id      = aws_apigatewayv2_api.http_api.id
  auto_deploy = true
}

# API Gateway Mapping
resource "aws_apigatewayv2_api_mapping" "api_mapping" {
  api_id      = aws_apigatewayv2_api.http_api.id
  domain_name = aws_apigatewayv2_domain_name.api_gateway_domain_name.id
  stage       = aws_apigatewayv2_stage.api_gateway_stage.id
}

# API Gateway Integrations (excluding data_fetcher_integration)
resource "aws_apigatewayv2_integration" "check_webhook_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.api_gateway_lambda.invoke_arn
}

resource "aws_apigatewayv2_integration" "submit_webhook_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.api_gateway_lambda.invoke_arn
}

# API Gateway Routes
resource "aws_apigatewayv2_route" "check_webhook_route" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /check-webhook"
  target    = "integrations/${aws_apigatewayv2_integration.check_webhook_integration.id}"
}

resource "aws_apigatewayv2_route" "submit_webhook_route" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /submit-webhook"
  target    = "integrations/${aws_apigatewayv2_integration.submit_webhook_integration.id}"
}


# Lambda Permissions for API Gateway
resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowAPIGatewayInvokeApiLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_gateway_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}
