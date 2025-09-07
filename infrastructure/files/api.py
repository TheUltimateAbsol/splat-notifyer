import json
import os
import urllib.request
import boto3
from datetime import datetime, timezone, timedelta
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

    TIME_SLOT_REGEX = re.compile(r"^\d{2}:\d{2}Z$")
    
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            return False, f"Rule at index {i} must be a dictionary."

        notification_message = rule.get("notificationMessage")
        if not isinstance(notification_message, str) or not notification_message.strip():
            return False, f"notificationMessage in rule {i} is required and must be a non-empty string."
        if len(notification_message) > 300:
            return False, f"notificationMessage in rule {i} cannot exceed 300 characters."

        match_type = rule.get("matchType")
        if match_type not in ["X-Battle", "Series", "Open"]:
            return False, f"matchType in rule {i} must be 'X-Battle' or 'Open' or 'Series'."

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
GENERALIZED_SCHEDULE_NODES = []
try:
    response = s3.get_object(Bucket=S3_BUCKET_NAME, Key=DATA_FILE_KEY)
    DATA = json.loads(response['Body'].read().decode('utf-8'))
    print(f"data.json loaded during init.")

    all_nodes = []

    # Process bankaraSchedules
    for schedule_node in DATA.get('data', {}).get('bankaraSchedules', {}).get('nodes', []):
        start_time = schedule_node['startTime']
        end_time = schedule_node['endTime']
        for setting in schedule_node.get('bankaraMatchSettings', []):
            match_type = ""
            if setting.get('bankaraMode') == "CHALLENGE":
                match_type = "Series"
            elif setting.get('bankaraMode') == "OPEN":
                match_type = "Open"
            
            all_nodes.append({
                "startTime": start_time,
                "endTime": end_time,
                "matchType": match_type,
                "matchSettings": setting
            })
    
    # Process xSchedules
    for schedule_node in DATA.get('data', {}).get('xSchedules', {}).get('nodes', []):
        start_time = schedule_node['startTime']
        end_time = schedule_node['endTime']
        setting = schedule_node.get('xMatchSetting', {})
        
        all_nodes.append({
            "startTime": start_time,
            "endTime": end_time,
            "matchType": "X-Battle",
            "matchSettings": setting
        })

    # Sort nodes by startTime descending
    def get_sort_key(node):
        try:
            dt_obj = datetime.fromisoformat(node['startTime'].replace('Z', '+00:00'))
            if dt_obj.tzinfo is None:
                dt_obj = dt_obj.replace(tzinfo=timezone.utc)
            return dt_obj
        except ValueError:
            # Handle invalid datetime format by returning a very old date.
            # This ensures they are at the end of the descending sorted list and effectively ignored.
            return datetime.min.replace(tzinfo=timezone.utc)
    
    GENERALIZED_SCHEDULE_NODES = sorted(all_nodes, key=get_sort_key, reverse=True)
    print(f"Generalized schedule nodes processed and sorted during init. Total nodes: {len(GENERALIZED_SCHEDULE_NODES)}")

except Exception as e:
    print(f"Error loading or processing {DATA_FILE_KEY} from S3 during init: {e}")

def process_notifications(payload, timestamp):
    webhook_url = payload.get('webhook_url')
    rules = payload.get('data', {}).get('rules', [])

    if not webhook_url or not rules:
        return False
    
    notifications = {}

    current_dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    if current_dt.tzinfo is None: # Ensure current_dt is timezone-aware
        current_dt = current_dt.replace(tzinfo=timezone.utc)

    for node in GENERALIZED_SCHEDULE_NODES:
        node_start_dt = datetime.fromisoformat(node['startTime'].replace('Z', '+00:00'))
        if node_start_dt.tzinfo is None: # Ensure node_start_dt is timezone-aware
            node_start_dt = node_start_dt.replace(tzinfo=timezone.utc)
        
        if node_start_dt <= current_dt:
            break

        battle_mode_name = node['matchSettings']['vsRule']['name']
        battle_mode_name = node['matchSettings']['vsRule']['name']
        map_names = [stage['name'] for stage in node['matchSettings']['vsStages']]
        map_ids = [stage['id'] for stage in node['matchSettings']['vsStages']]


        for rule in rules:
            # Check matchType
            if rule['matchType'] != node['matchType']:
                continue

            # Check battleModes
            vs_rule_id = node['matchSettings']['vsRule']['id']
            if vs_rule_id not in rule['battleModes'] or not rule['battleModes'][vs_rule_id]:
                continue
            
            # Check timeSlots (ignore date)
            node_time_str = node_start_dt.strftime("%H:%M") + "Z"
            if node_time_str not in rule['timeSlots']:
                continue

            # Check maps
            rule_map_details = rule['maps'].get(vs_rule_id)
            if not rule_map_details:
                continue
            
            notify_type = rule_map_details['notifyType']
            selected_maps = rule_map_details['selectedMaps']
            
            map_match = False
            if notify_type == "at-least-one":
                if any(map_id in selected_maps for map_id in map_ids):
                    map_match = True
            elif notify_type == "two-same-rotation":
                if all(map_id in selected_maps for map_id in map_ids) and len(map_ids) == 2:
                    map_match = True
            
            if not map_match:
                continue

            # If all criteria met, add to notifications dict
            notification_message_key = rule['notificationMessage']
            if notification_message_key not in notifications:
                notifications[notification_message_key] = []
            notifications[notification_message_key].append(node)
    
    if not notifications:
        return True # Return True even if no notifications, as processing was successful.

    for notification_message, matched_nodes_list in notifications.items():
        message_parts = [notification_message]
        for matched_node in matched_nodes_list:
            node_start_dt = datetime.fromisoformat(matched_node['startTime'].replace('Z', '+00:00'))
            unix_timestamp = int(node_start_dt.timestamp())
            node_end_dt = datetime.fromisoformat(matched_node['endTime'].replace('Z', '+00:00'))
            if node_end_dt.tzinfo is None: # Ensure node_end_dt is timezone-aware
                node_end_dt = node_end_dt.replace(tzinfo=timezone.utc)
            unix_end_timestamp = int(node_end_dt.timestamp())
            
            summary_battle_mode_name = matched_node['matchSettings']['vsRule']['name']
            summary_match_type = matched_node['matchType']
            summary_map_names = ", ".join([stage['name'] for stage in matched_node['matchSettings']['vsStages']])
            summary_timeslot = f"<t:{unix_timestamp}:f> - <t:{unix_end_timestamp}:T>"
            
            message_parts.append(
                f"-  **{summary_timeslot}**: {summary_map_names} {summary_battle_mode_name} ({summary_match_type})"
            )
        
        full_message = "\n".join(message_parts)
        send_discord_message(webhook_url, full_message)
    
    return True

def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    webhook_url = event.get('webhook_url')
    data_payload = event.get('data')
    
    if not webhook_url or not data_payload:
        print("Webhook URL or data payload missing from lambda event.")
        return {
            'statusCode': 400,
            'body': json.dumps('Invalid event payload for notifications.')
        }

    # Calculate timestamp 22 hours in the future from now (UTC)
    future_timestamp = datetime.now(timezone.utc) + timedelta(hours=22)
    
    full_notification_payload = {
        "webhook_url": webhook_url,
        "data": data_payload
    }
    
    result = process_notifications(full_notification_payload, future_timestamp.isoformat())

    if not result:
        return {
            'statusCode': 500,
            'body': json.dumps('Failed to process some notifications.')
        }
    
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

        print(f"DEBUG: Entering /check-webhook for URL: {webhook_url}")
        # Validate webhook by sending a message
        if not send_discord_message(webhook_url, "Validating Splat-Notifyer Webhook..."):
            print(f"DEBUG: Webhook validation failed for URL: {webhook_url}")
            return {
                'statusCode': 400,
                'body': json.dumps({"message": "Webhook Validation Failure"})
            }
        print(f"DEBUG: Webhook validated successfully for URL: {webhook_url}")

        # Query DynamoDB
        try:
            print(f"DEBUG: Querying DynamoDB for webhook_url: {webhook_url}")
            response = table.get_item(Key={'webhook_url': webhook_url})
            item = response.get('Item')
            print(f"DEBUG: DynamoDB response for {webhook_url}: {item}")
            if item and 'schedule' in item:
                schedule_name = item['schedule']
                print(f"DEBUG: Found schedule {schedule_name} in DynamoDB for {webhook_url}")
                try:
                    print(f"DEBUG: Getting schedule details for {schedule_name}")
                    schedule_response = scheduler_client.get_schedule(
                        Name=schedule_name,
                        GroupName=EVENTBRIDGE_SCHEDULE_GROUP_NAME
                    )
                    schedule_input_str = schedule_response['Target']['Input']
                    schedule_input = json.loads(schedule_input_str)
                    data_from_schedule = schedule_input.get('data', {})
                    print(f"DEBUG: Retrieved data from schedule for {webhook_url}: {data_from_schedule}")
                    return {
                        'statusCode': 200,
                        'headers': {'Content-Type': 'application/json'},
                        'body': json.dumps({"exists": True, "config": data_from_schedule})
                    }
                except scheduler_client.exceptions.ResourceNotFoundException:
                    print(f"ERROR: Schedule {schedule_name} not found for webhook {webhook_url}")
                    return {
                        'statusCode': 200,
                        'headers': {'Content-Type': 'application/json'},
                        'body': json.dumps({"exists": False})
                    }
                except Exception as e:
                    print(f"ERROR: Error retrieving schedule for webhook {webhook_url}: {e}")
                    return {
                        'statusCode': 500,
                        'headers': {'Content-Type': 'application/json'},
                        'body': json.dumps({"message": "Internal server error during schedule retrieval."})
                    }
            else:
                print(f"DEBUG: No schedule found in DynamoDB for webhook_url: {webhook_url}")
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({"exists": False})
                }
        except Exception as e:
            print(f"ERROR: Error querying DynamoDB for webhook {webhook_url}: {e}")
            return {
                'statusCode': 500,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({"message": "Internal server error during database query."})
            }
    elif path == '/submit-webhook' and http_method == 'POST':
        # Use the entire body as the payload for validation
        is_valid, error_message = validate_rules_payload(body)
        if not is_valid:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({"message": f"Invalid payload: {error_message}"})
            }
            
        webhook_url = body.get('webhookUrl') # Changed to webhookUrl
        data = {k: v for k, v in body.items() if k != 'webhookUrl'} # Extract data excluding webhookUrl

        # Existing webhook validation (using the new webhookUrl from the payload)
        if not send_discord_message(webhook_url, "Initializing Splat-Notifyer Webhook..."):
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({"message": "Webhook Validation Failure"})
            }

        current_timestamp = datetime.now(timezone.utc).isoformat()
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
                'headers': {'Content-Type': 'application/json'},
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
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({"message": "Internal server error during database update."})
            }
        
        # Invoke process_notifications
        try:
            full_notification_payload = {
                "webhook_url": webhook_url,
                "data": data
            }
            process_notifications(full_notification_payload, current_timestamp)
        except Exception as e:
            print(f"Error invoking process_notifications during submission: {e}")

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({"message": "Webhook submitted and schedule configured successfully.", "schedule_name": schedule_name})
        }
    
    return {
        'statusCode': 404,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({"message": "Not Found"})
    }
