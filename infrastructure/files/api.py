import json
import os
import urllib.request
import boto3
from datetime import datetime
import re

# S3 related imports and environment variables from notifyer_update.py
s3 = boto3.client("s3")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME", "splat-notifyer-data")
DATA_FILE_KEY = os.environ.get("DATA_FILE_KEY", "data.json")

DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "splat-notifyer-webhooks")
EVENTBRIDGE_ROLE_ARN = os.environ.get("EVENTBRIDGE_ROLE_ARN") # ARN for the role that EventBridge will assume
EVENTBRIDGE_SCHEDULE_GROUP_NAME = os.environ.get("EVENTBRIDGE_SCHEDULE_GROUP_NAME", "splat-notifyer-schedules")
DESTINATION_LAMBDA_ARN = os.environ.get("DESTINATION_LAMBDA_ARN") # ARN of the Lambda function that the schedule will invoke

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE_NAME)
scheduler_client = boto3.client("scheduler")

def send_discord_message(webhook_url, message_content):
    payload = {
        "content": message_content
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "python-requests/2.32.3"
    }
    req = urllib.request.Request(webhook_url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            status_code = response.getcode()
            return 200 <= status_code < 300
    except urllib.error.URLError as e:
        print(f"Error sending message to Discord: {e}")
        return False

def validate_rules_payload(payload):
    # Top-level validation
    if not isinstance(payload, dict):
        return False, "Payload must be a dictionary."
    
    webhook_url = payload.get("webhookUrl")
    rules = payload.get("rules")

    if not isinstance(webhook_url, str) or not webhook_url:
        return False, "webhookUrl is required and must be a non-empty string."

    if not isinstance(rules, list):
        return False, "rules is required and must be a list."

    TIME_SLOT_REGEX = re.compile(r"^\d{2}:\d{2}-\d{2}:\d{2} UTC$")
    
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            return False, f"Rule at index {i} must be a dictionary."

        notification_message = rule.get("notificationMessage")
        if not isinstance(notification_message, str) or not notification_message.strip():
            return False, f"notificationMessage in rule {i} is required and must be a non-empty string."
        if len(notification_message) > 300:
            return False, f"notificationMessage in rule {i} cannot exceed 300 characters."

        match_type = rule.get("matchType")
        if match_type not in ["X-Battle", "Open"]:
            return False, f"matchType in rule {i} must be 'X-Battle' or 'Open'."

        time_slots = rule.get("timeSlots")
        if not isinstance(time_slots, list):
            return False, f"timeSlots in rule {i} is required and must be a list."
        for j, slot in enumerate(time_slots):
            if not isinstance(slot, str) or not TIME_SLOT_REGEX.match(slot):
                return False, f"timeSlots[{j}] in rule {i} is invalid. Expected format HH:MM-HH:MM UTC."

        battle_modes = rule.get("battleModes")
        if not isinstance(battle_modes, dict):
            return False, f"battleModes in rule {i} is required and must be a dictionary."
        for mode_name, is_enabled in battle_modes.items():
            if not isinstance(mode_name, str) or not mode_name:
                return False, f"battleModes key in rule {i} must be a non-empty string."
            if not isinstance(is_enabled, bool):
                return False, f"battleModes value for '{mode_name}' in rule {i} must be a boolean."

        maps = rule.get("maps")
        if not isinstance(maps, dict):
            return False, f"maps in rule {i} is required and must be a dictionary."
        for mode_name, map_details in maps.items():
            if not isinstance(mode_name, str) or not mode_name:
                return False, f"maps key in rule {i} must be a non-empty string."
            if not isinstance(map_details, dict):
                return False, f"map details for '{mode_name}' in rule {i} must be a dictionary."
            
            notify_type = map_details.get("notifyType")
            if notify_type not in ["at-least-one", "two-same-rotation"]:
                return False, f"notifyType for map '{mode_name}' in rule {i} must be 'at-least-one' or 'two-same-rotation'."

            selected_maps = map_details.get("selectedMaps")
            if not isinstance(selected_maps, list):
                return False, f"selectedMaps for map '{mode_name}' in rule {i} is required and must be a list."
            if not all(isinstance(m, str) and m for m in selected_maps):
                return False, f"All selectedMaps for map '{mode_name}' in rule {i} must be non-empty strings."

    return True, "Payload is valid."

# Load data.json during the Lambda initialization phase
DATA = {}
try:
    response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=DATA_FILE_KEY)
    DATA = json.loads(response['Body'].read().decode('utf-8'))
    print(f"data.json loaded during init: {DATA}")
except Exception as e:
    print(f"Error loading {DATA_FILE_KEY} from S3 during init: {e}")

def process_notifications(timestamp):
    # Placeholder for notification processing logic
    print(f"Processing notifications for timestamp: {timestamp}")
    # The DATA variable is now available globally, loaded during init.
    print(f"Global DATA content (in process_notifications): {DATA}")
    # In a real scenario, you would implement logic here to use the pre-loaded DATA
    # and perform actions based on the timestamp and the event data.

def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    # Extract timestamp or other relevant data from the EventBridge event
    timestamp = event.get('time', 'N/A')
    
    process_notifications(timestamp)
    
    return {
        'statusCode': 200,
        'body': json.dumps('Notifyer update processed successfully!')
    }

def handler(event, context):
    http_method = event.get('httpMethod')
    path = event.get('path')
    body = json.loads(event.get('body') or str({})) # Sets if explicitly "None"

    if path == '/check-webhook' and http_method == 'GET':
        query_params = event.get('queryStringParameters', {})
        webhook_url = query_params.get('webhookUrl') # Changed to webhookUrl to match payload structure suggestion
        if not webhook_url:
            return {
                'statusCode': 400,
                'body': json.dumps({"message": "Webhook URL is required."})
            }

        # Validate webhook by sending a message
        if not send_discord_message(webhook_url, "Validating Splat-Notifyer Webhook..."):
            return {
                'statusCode': 400,
                'body': json.dumps({"message": "Webhook Validation Failure"})
            }

        # Query DynamoDB
        try:
            response = table.get_item(Key={'webhook_url': webhook_url})
            item = response.get('Item')
            if item and 'schedule' in item:
                schedule_name = item['schedule']
                try:
                    schedule_response = scheduler_client.get_schedule(
                        Name=schedule_name,
                        GroupName=EVENTBRIDGE_SCHEDULE_GROUP_NAME
                    )
                    schedule_input_str = schedule_response['Target']['Input']
                    schedule_input = json.loads(schedule_input_str)
                    data_from_schedule = schedule_input.get('data', {})
                    return {
                        'statusCode': 200,
                        'body': json.dumps(data_from_schedule)
                    }
                except scheduler_client.exceptions.ResourceNotFoundException:
                    print(f"Schedule {schedule_name} not found for webhook {webhook_url}")
                    return {
                        'statusCode': 200,
                        'body': json.dumps({})
                    }
                except Exception as e:
                    print(f"Error retrieving schedule for webhook {webhook_url}: {e}")
                    return {
                        'statusCode': 500,
                        'body': json.dumps({"message": "Internal server error during schedule retrieval."})
                    }
            else:
                return {
                    'statusCode': 200,
                    'body': json.dumps({})
                }
        except Exception as e:
            print(f"Error querying DynamoDB: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps({"message": "Internal server error during database query."})
            }
    elif path == '/submit-webhook' and http_method == 'POST':
        # Use the entire body as the payload for validation
        is_valid, error_message = validate_rules_payload(body)
        if not is_valid:
            return {
                'statusCode': 400,
                'body': json.dumps({"message": f"Invalid payload: {error_message}"})
            }
            
        webhook_url = body.get('webhookUrl') # Changed to webhookUrl
        data = {k: v for k, v in body.items() if k != 'webhookUrl'} # Extract data excluding webhookUrl

        # Existing webhook validation (using the new webhookUrl from the payload)
        if not send_discord_message(webhook_url, "Initializing Splat-Notifyer Webhook..."):
            return {
                'statusCode': 400,
                'body': json.dumps({"message": "Webhook Validation Failure"})
            }

        current_timestamp = datetime.utcnow().isoformat()
        schedule_name = f"splat-notifyer-{abs(hash(webhook_url))}" # Unique name for schedule

        # Create/Update EventBridge Schedule
        try:
            schedule_description = f"Schedule for webhook {webhook_url}"
            scheduler_client.create_schedule(
                FlexibleTimeWindow={'Mode': 'OFF'},
                Name=schedule_name,
                GroupName=EVENTBRIDGE_SCHEDULE_GROUP_NAME,
                Description=schedule_description,
                ScheduleExpression='cron(10 0/2 * * ? *)',
                Target={
                    'Arn': DESTINATION_LAMBDA_ARN,
                    'RoleArn': EVENTBRIDGE_ROLE_ARN,
                    'Input': json.dumps({
                        'webhook_url': webhook_url,
                        'data': data
                    })
                },
                State='ENABLED',
                ActionAfterCompletion='NONE'
            )
        except scheduler_client.exceptions.ConflictException:
            # If schedule exists, update it
            scheduler_client.update_schedule(
                FlexibleTimeWindow={'Mode': 'OFF'},
                Name=schedule_name,
                GroupName=EVENTBRIDGE_SCHEDULE_GROUP_NAME,
                Description=schedule_description,
                ScheduleExpression='cron(10 0/2 * * ? *)',
                Target={
                    'Arn': DESTINATION_LAMBDA_ARN,
                    'RoleArn': EVENTBRIDGE_ROLE_ARN,
                    'Input': json.dumps({
                        'webhook_url': webhook_url,
                        'data': data
                    })
                },
                State='ENABLED',
                ActionAfterCompletion='NONE'
            )
        except Exception as e:
            print(f"Error creating/updating EventBridge schedule: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps({"message": f"Error configuring notification schedule: {e}"})
            }

        # Update DynamoDB
        try:
            table.put_item(
                Item={
                    'webhook_url': webhook_url,
                    'schedule': schedule_name,
                    'updated_at': current_timestamp
                }
            )
        except Exception as e:
            print(f"Error updating DynamoDB: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps({"message": "Internal server error during database update."})
            }
        
        # Invoke process_notifications
        try:
            process_notifications(current_timestamp)
        except Exception as e:
            print(f"Error invoking process_notifications: {e}")
            # This error might not be critical enough to fail the whole submission
            # but should be logged and potentially handled differently.

        return {
            'statusCode': 200,
            'body': json.dumps({"message": "Webhook submitted and schedule configured successfully.", "schedule_name": schedule_name})
        }
    
    return {
        'statusCode': 404,
        'body': json.dumps({"message": "Not Found"})
    }