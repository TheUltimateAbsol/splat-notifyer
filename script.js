let initialWebhookUrl = document.getElementById('webhook-url').value; // Store initial webhook URL
let isWebhookValidated = false; // Track webhook validation status
let mapsData = {}; // Store maps.json data globally
let battleModesData = {}; // Store batle-modes.json data globally

// Helper function to escape special characters in CSS selectors, particularly useful for IDs
function escapeCssSelector(selector) {
    return CSS.escape(selector);
}

// Client-side JavaScript for handling timezone conversion and dynamic form elements

// Function to generate time slots (moved to global scope)
function generateTimeSlots(container, ruleNum, selectedSlots = []) {
    container.innerHTML = ''; // Clear existing
    container.classList.add('time-slots-container'); // Add class for grid display

    const now = new Date();
    const userTimezoneOffsetMinutes = now.getTimezoneOffset(); // Difference in minutes between UTC and local time

    const timeSlotData = [];

    for (let hour = 0; hour < 24; hour += 2) {
        // UTC start time
        let utcStart = new Date();
        utcStart.setUTCHours(hour, 0, 0, 0);

        // Convert to local time
        let localStart = new Date(utcStart.getTime() - (userTimezoneOffsetMinutes * 60 * 1000));
        let localEnd = new Date(localStart.getTime() + (2 * 60 * 60 * 1000)); // Add 2 hours for the end of the slot

        // Store data for sorting
        timeSlotData.push({
            utcStartHour: hour,
            localStart: localStart,
            localEnd: localEnd,
            timeValue: `${hour.toString().padStart(2, '0')}:00Z`, // Use HH:00Z format for UTC start time
        });
    }

    // Sort time slots: 11 PM (23:00) first, 10 PM (22:00) last.
    timeSlotData.sort((a, b) => {
        const hourA = a.localStart.getHours();
        const hourB = b.localStart.getHours();

        // Custom sorting logic for 11 PM (23:00) first, 10 PM (22:00) last
        if (hourA === 23) return -1; // 11 PM (23:00) comes first
        if (hourB === 23) return 1;

        if (hourA === 22) return 1; // 10 PM (22:00) comes last
        if (hourB === 22) return -1;

        return hourA - hourB; // Otherwise, sort normally by hour
    });

    // Function to format hour to 12-hour format, omitting leading zeros
    const formatTo12Hour = (date) => {
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours === 0 ? 12 : hours; // the hour '0' should be '12'
        
        // Omit leading zero for hours
        return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    };

    // Get the local timezone abbreviation
    const timezoneAbbr = new Date().toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ').pop();

    // Generate HTML for sorted time slots as selectable boxes
    timeSlotData.forEach(slot => {
        const displayStartTime = formatTo12Hour(slot.localStart);
        const displayEndTime = formatTo12Hour(slot.localEnd);

        const displayTime = `${displayStartTime} - ${displayEndTime} ${timezoneAbbr}`;
        const isSelected = selectedSlots.includes(slot.timeValue) ? 'selected' : '';

        container.innerHTML += `
            <div class="timeslot-box ${isSelected}" data-time-value="${slot.timeValue}" data-rule-num="${ruleNum}">
                ${displayTime}
            </div>
        `;
    });
}

// Function to attach listeners for dynamically added content (moved to global scope)
function attachDynamicListeners() {
    document.querySelectorAll('.rule-section').forEach(ruleSection => {
        const ruleNum = ruleSection.id.split('-')[1];

        // Generate time slots for new sections (if not already present)
        const timeSlotsContainer = ruleSection.querySelector(`#time-slots-${ruleNum}`);
        if (timeSlotsContainer && timeSlotsContainer.children.length === 0) {
            generateTimeSlots(timeSlotsContainer, ruleNum);
        }
        // Attach click listeners to new timeslot boxes
        const timeslotBoxes = ruleSection.querySelectorAll(`.timeslot-box[data-rule-num="${ruleNum}"]`);
        timeslotBoxes.forEach(box => {
            box.removeEventListener('click', handleTimeslotBoxClick);
            box.addEventListener('click', handleTimeslotBoxClick);
        });

        // Ensure notification message textarea has correct text color when rule section style changes.
        // This is primarily handled by CSS, but a redundant JS check won't hurt.
        const notificationMessageInput = ruleSection.querySelector(`.notification-message-input`);
        if (notificationMessageInput) {
            // Re-apply common classes to ensure any dynamic updates are considered
            // (e.g., if a selected match type changes the overall rule-section background)
            if (ruleSection.classList.contains('selected-open') || ruleSection.classList.contains('selected-series') || ruleSection.classList.contains('selected-x-battle')) {
                notificationMessageInput.style.color = 'black'; // Explicitly set to black when rule section is selected
            } else {
                notificationMessageInput.style.color = 'black'; // Ensure it's black by default
            }
        }

        // Battle mode buttons for new sections
        const battleModeButtons = ruleSection.querySelectorAll(`.battle-mode-button[data-rule-num="${ruleNum}"]`);
        battleModeButtons.forEach(button => {
            button.removeEventListener('click', handleBattleModeButtonClick); // Prevent duplicate listeners
            button.addEventListener('click', handleBattleModeButtonClick);
        });

        // Attach listeners for map items if they exist
        attachMapItemListeners(ruleNum);

        // Attach listeners for new match type buttons
        const matchTypeButtons = ruleSection.querySelectorAll(`.match-type-button[data-rule-num="${ruleNum}"]`);
        matchTypeButtons.forEach(button => {
            button.removeEventListener('click', handleMatchTypeButtonClick);
            button.addEventListener('click', handleMatchTypeButtonClick);
        });

        // Attach listeners for new notify type buttons
        const notifyTypeButtons = ruleSection.querySelectorAll(`.notify-type-button[data-rule-num="${ruleNum}"]`);
        notifyTypeButtons.forEach(button => {
            button.removeEventListener('click', handleNotifyTypeButtonClick);
            button.addEventListener('click', handleNotifyTypeButtonClick);
        });
    });
}

function handleMatchTypeButtonClick(event) {
    const clickedButton = event.currentTarget;
    const ruleNum = clickedButton.dataset.ruleNum;
    const matchType = clickedButton.dataset.matchType;

    // Deselect all buttons for this rule number
    document.querySelectorAll(`.match-type-button[data-rule-num="${ruleNum}"]`).forEach(button => {
        button.classList.remove('selected', 'open', 'series', 'x-battle');
    });

    // Select the clicked button and add the specific class for styling
    clickedButton.classList.add('selected', matchType.toLowerCase());
    updateRuleSectionStyle(ruleNum, matchType); // Update rule section style
}

// Function to update the style of a rule section based on selected match type
function updateRuleSectionStyle(ruleNum, matchType) {
    const ruleSection = document.getElementById(`rule-${ruleNum}`);
    if (!ruleSection) return;

    // Remove all previous match type coloring classes
    ruleSection.classList.remove('selected-open', 'selected-series', 'selected-x-battle');
    ruleSection.style.borderColor = '#ccc'; // Reset to default border color

    // Apply new classes and border color based on selected match type
    if (matchType === 'Open') {
        ruleSection.classList.add('selected-open');
        ruleSection.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--open-match-type-color').trim();
    } else if (matchType === 'Series') {
        ruleSection.classList.add('selected-series');
        ruleSection.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--series-match-type-color').trim();
    } else if (matchType === 'X-Battle') {
        ruleSection.classList.add('selected-x-battle');
        ruleSection.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--x-battle-match-type-color').trim();
    }
}

function handleNotifyTypeButtonClick(event) {
    const clickedButton = event.currentTarget;
    const ruleNum = clickedButton.dataset.ruleNum;
    const modeId = clickedButton.dataset.modeId;

    // Deselect all buttons for this battle mode and rule number
    document.querySelectorAll(`.notify-type-button[data-rule-num="${ruleNum}"][data-mode-id="${modeId}"]`).forEach(button => {
        button.classList.remove('selected');
    });

    // Select the clicked button
    clickedButton.classList.add('selected');
}

// Hide/show map selectors based on battle mode checkboxes (moved to global scope)
function handleBattleModeButtonClick(event) {
    const button = event.currentTarget;
    const ruleNum = button.dataset.ruleNum;
    const modeId = button.dataset.modeId;
    const escapedModeId = escapeCssSelector(modeId);
    const modeName = battleModesData[modeId] ? battleModesData[modeId].name : modeId;
    const mapSelectorsContainer = document.getElementById(`map-selectors-container-${ruleNum}`);
    let mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${escapedModeId}-${ruleNum}`);

    button.classList.toggle('selected');
    const isSelected = button.classList.contains('selected');

    if (isSelected && !mapSelector) {
        // If map selector doesn't exist and button is selected, generate and append it
        mapSelectorsContainer.insertAdjacentHTML('beforeend', generateMapSelector(modeId, modeName, ruleNum, null));
        mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${escapedModeId}-${ruleNum}`);
    }

    if (mapSelector) {
        mapSelector.classList.toggle('hidden', !isSelected);
    }
}

document.addEventListener('DOMContentLoaded', async (event) => {
    // Fetch maps and battle modes data
    await fetchMapsData();
    await fetchBattleModesData();

    // Initial call to generate time slots and map items for the first rule
    generateTimeSlots(document.getElementById('time-slots-1'), 1);


    // Manually generate battle mode buttons for rule-1 initially, passing an empty object for selected states
    const battleModeSelectionContainer1 = document.getElementById('battle-mode-selection-1');
    if (battleModeSelectionContainer1) {
        battleModeSelectionContainer1.innerHTML = `
            ${generateBattleModeButton('VnNSdWxlLTE=', 'Splat Zones', 1, {})}
            ${generateBattleModeButton('VnNSdWxlLTI=', 'Tower Control', 1, {})}
            ${generateBattleModeButton('VnNSdWxlLTM=', 'Rainmaker', 1, {})}
            ${generateBattleModeButton('VnNSdWxlLTQ=', 'Clam Blitz', 1, {})}
        `;
    }
    
    // Attach event listeners for the initial battle mode buttons, and trigger click events if needed based on pre-existing config
    const initialBattleModeButtons = document.querySelectorAll(`.battle-mode-button[data-rule-num="1"]`);
    initialBattleModeButtons.forEach(button => {
        button.addEventListener('click', handleBattleModeButtonClick);
        // If loading an existing config (which happens in populateFormWithJSON),
        // we need to set the 'selected' class and trigger the click handler to show map selectors.
        // This initial DOMContentLoaded block will not have config data, so we don't trigger clicks here.
        // The populateFormWithJSON function will handle pre-selecting and triggering.
    });
    
    attachDynamicListeners(); // This is for general dynamic elements, not specifically initial battle modes.

    // "Add Another" button functionality
    document.getElementById('add-another-rule').addEventListener('click', addAnotherRule);

    // Attach event listener for the delete button of the initial rule #1
    const initialDeleteButton = document.querySelector('.rule-section#rule-1 .delete-rule-button');
    if (initialDeleteButton) {
        initialDeleteButton.addEventListener('click', deleteRule);
    }

    const webhookUrlInput = document.getElementById('webhook-url');
    const checkWebhookButton = document.getElementById('check-webhook');

    // Add "enter" key functionality to the webhook textbox
    webhookUrlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent default form submission
            checkWebhookButton.click(); // Trigger the click event of the check-webhook button
        }
    });

    checkWebhookButton.addEventListener('click', async () => {
        const webhookUrl = webhookUrlInput.value;
        const webhookFeedback = document.getElementById('webhook-feedback');

        if (!webhookUrl) {
            webhookFeedback.innerHTML = '<span class="error-message">Webhook URL cannot be empty.</span>';
            webhookFeedback.style.color = 'red';
            document.getElementById('main-form-container').classList.add('hidden');
            isWebhookValidated = false;
            return;
        }

        webhookFeedback.innerHTML = 'Checking...';
        webhookFeedback.style.color = 'black';

        try {
            const apiUrl = "https://api-splat-notifyer.splatpass.net";
            const response = await fetch(`${apiUrl}/check-webhook?webhookUrl=${encodeURIComponent(webhookUrl)}`);
            const data = await response.json(); // Assuming the backend returns JSON
            
            // The API will return { exists: true, config: {...} } if the webhook exists
            // Or { exists: false } if it does not.
            // For valid webhooks, we assume it's valid if we get a 200 OK.
            if (response.ok) {
                isWebhookValidated = true;
                initialWebhookUrl = webhookUrl; // Update initial URL upon successful validation
                const mainFormContainer = document.getElementById('main-form-container');

                if (data.exists && data.config) {
                    webhookFeedback.innerHTML = '<span style="color: green;">Existing Webhook Found!</span>';
                    
                    // Check if the form is currently visible BEFORE prompting
                    if (!mainFormContainer.classList.contains('hidden')) {
                        const confirmLoad = confirm('Load in existing config? This will erase any existing changes.');
                        if (confirmLoad) {
                            populateFormWithJSON(data.config.rules); // Pass only the rules config
                        } else {
                        }
                    } else {
                        // If the form is not visible, make it visible and populate without asking for confirmation
                        mainFormContainer.classList.remove('hidden');
                        populateFormWithJSON(data.config.rules); // Pass only the rules config
                    }
                } else {
                    // For new webhooks, always make the form visible and populate with an empty config
                    webhookFeedback.innerHTML = '<span style="color: green;">Webhook URL is valid.</span>';
                    mainFormContainer.classList.remove('hidden'); // Make form visible
                    populateFormWithJSON([]); // Clear all rules and add one empty rule
                }
            } else {
                webhookFeedback.innerHTML = `<span class="error-message">${data.error || 'Invalid Webhook URL'}</span>`;
                webhookFeedback.style.color = 'red';
                document.getElementById('main-form-container').classList.add('hidden');
                isWebhookValidated = false;
            }
        } catch (error) {
            webhookFeedback.innerHTML = `<span class="error-message">Error checking webhook: ${error.message}</span>`;
            webhookFeedback.style.color = 'red';
            document.getElementById('main-form-container').classList.add('hidden');
            isWebhookValidated = false;
            console.error('Error checking webhook URL:', error);
        }
    });

    // Re-attach event listeners for dynamically added content
    document.addEventListener('DOMContentLoaded', attachDynamicListeners); // Initial call
    // Since htmx:afterSwap is removed, we need a way to re-attach listeners for dynamically added rules.
    // The addAnotherRule function already calls attachDynamicListeners, so that covers new rules.
    // The populateFormWithJSON will also need to call attachDynamicListeners.
    // The generic htmx:afterSwap listener below can be removed as well.

    // document.body.addEventListener('htmx:afterSwap', (e) => {
    //     console.log('HTMX: Generic afterSwap detected, target:', e.detail.target.id || e.detail.target.tagName, 'url:', e.detail.xhr.responseURL
    // });



});

// The hx-on::after-request on #main-form-container now handles calling populateFormWithJSON
// So this simulation block is no longer needed.

document.getElementById('main-submit-button').addEventListener('click', async (event) => {
    event.preventDefault(); // Prevent default form submission

    const submitButton = event.currentTarget;
    const originalButtonText = submitButton.textContent;
    const originalButtonBg = submitButton.style.backgroundColor; // Store original background
    const responseDiv = document.getElementById('response');

    // Clear and hide previous response
    responseDiv.innerHTML = '';
    responseDiv.style.display = 'none';

    if (!validateForm()) {
        // If validation fails, the validateForm function will display errors to responseDiv
        // and set its display to 'block'.
        return;
    }

    // Indicate submitting state
    submitButton.textContent = 'Submitting...';
    submitButton.style.backgroundColor = '#6c757d'; // Dark grey for submitting state
    submitButton.disabled = true; // Disable button to prevent multiple submissions

    const formData = collectFormData();
    const jsonPayload = JSON.stringify(formData);

    try {
        const apiUrl = "https://api-splat-notifyer.splatpass.net";
        const response = await fetch(`${apiUrl}/submit-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: jsonPayload,
        });

        const result = await response.json();
        if (response.ok) {
            responseDiv.innerHTML = `<span style="color: green;"><span style="font-family: 'BlitzBold', sans-serif;">Configuration submitted successfully!</span></span>`;
            responseDiv.style.display = 'block'; // Show success message
            // No need to show JSON on success unless explicitly requested
        } else {
            responseDiv.innerHTML = `<span style="color: red;"><span style="font-family: 'BlitzBold', sans-serif;">Error submitting configuration:</span><pre>${JSON.stringify(result, null, 2)}</pre></span>`;
            responseDiv.style.display = 'block'; // Show error message
            console.error('Error submitting configuration:', result);
        }
        responseDiv.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        responseDiv.innerHTML = `<span style="color: red;"><span style="font-family: 'BlitzBold', sans-serif;">Network error:</span> ${error.message}</span>`;
        responseDiv.style.display = 'block'; // Show network error
        responseDiv.scrollIntoView({ behavior: 'smooth' });
        console.error('Network error:', error);
    } finally {
        // Restore button state
        submitButton.textContent = originalButtonText;
        submitButton.style.backgroundColor = originalButtonBg || ''; // Restore original or clear if it was default
        submitButton.disabled = false;
    }
});

function collectFormData() {
    const data = {
        webhookUrl: document.getElementById('webhook-url').value,
        rules: []
    };

    document.querySelectorAll('.rule-section').forEach(ruleSection => {
        const ruleNum = parseInt(ruleSection.id.split('-')[1]);
        const rule = {};

        const notificationMessageInput = ruleSection.querySelector(`textarea[name="notificationMessage-${ruleNum}"]`); // Changed to textarea
        if (notificationMessageInput) {
            rule.notificationMessage = notificationMessageInput.value;
        }
        // The 'required' attribute on the input, combined with validateForm(),
        // ensures this field will always have a non-empty value if the form is submitted.
        // If notificationMessageInput is null, it's a structural HTML issue.

        const selectedMatchTypeButton = ruleSection.querySelector(`.match-type-button[data-rule-num="${ruleNum}"].selected`);
        rule.matchType = selectedMatchTypeButton ? selectedMatchTypeButton.dataset.matchType : '';
        
        rule.timeSlots = [];
        rule.battleModes = {}; // Initialize as an object rather than array to store true/false
        rule.maps = {};

        // Collect time slots
        ruleSection.querySelectorAll(`.timeslot-box.selected`).forEach(box => {
            rule.timeSlots.push(box.dataset.timeValue);
        });

        // Collect battle modes and associated maps/notify types
        const selectedBattleModeButtons = ruleSection.querySelectorAll(`.battle-mode-button[data-rule-num="${ruleNum}"].selected`);
        selectedBattleModeButtons.forEach(button => {
            const modeId = button.dataset.modeId; // Store the base64 ID
            const escapedModeId = escapeCssSelector(modeId);
            rule.battleModes[modeId] = true; // Mark as selected

            const mapSelectorsContainer = document.getElementById(`map-selectors-container-${ruleNum}`);
            const mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${escapedModeId}-${ruleNum}`);
            
            // Only collect map data if the map selector is visible
            if (mapSelector && !mapSelector.classList.contains('hidden')) {
                const selectedMaps = [];
                mapSelector.querySelectorAll(`.map-item.selected`).forEach(mapItem => {
                    selectedMaps.push(mapItem.dataset.mapId);
                });

                const selectedNotifyButton = mapSelector.querySelector(`.notify-type-button.selected[data-mode-id="${modeId}"][data-rule-num="${ruleNum}"]`);
                const notifyType = selectedNotifyButton ? selectedNotifyButton.dataset.notifyType : 'at-least-one'; // Default if none selected

                rule.maps[modeId] = { // Use modeId as key for rule.maps
                    selectedMaps: selectedMaps,
                    notifyType: notifyType
                };
            }
        });

        data.rules.push(rule);
    });
    return data;
}

function validateForm() {
    let isValid = true;
    let errorMessage = '';

    // Create a snapshot of the form data to validate against
    const collectedData = collectFormData();

    // 1. Webhook URL validation
    const webhookUrlInput = document.getElementById('webhook-url');
    if (!webhookUrlInput.value) {
        errorMessage += 'Webhook URL cannot be empty.<br>';
        isValid = false;
    } else if (webhookUrlInput.value !== initialWebhookUrl && !isWebhookValidated) {
        errorMessage += 'Webhook URL has changed and needs to be re-validated.<br>';
        isValid = false;
    } else if (!isWebhookValidated) { // Check if it's explicitly not validated
         errorMessage += 'Webhook URL is not validated. Please click "Check".<br>';
         isValid = false;
    }

    // 2. At least one notification rule from collected data
    if (collectedData.rules.length === 0) {
        errorMessage += 'There must be at least one notification rule.<br>';
        isValid = false;
    }

    collectedData.rules.forEach((rule, index) => {
        const ruleNum = index + 1; // Use index + 1 for rule number since ruleCounter is manipulated
        let ruleErrors = [];

        // Validate Notification Message
        if (!rule.notificationMessage.trim()) {
            ruleErrors.push('Notification Message cannot be empty.');
        } else if (rule.notificationMessage.length > 300) {
            ruleErrors.push('Notification Message cannot exceed 300 characters.');
        }

        // 3. In each notification rule:
        //    a. At least one match type selected
        if (!rule.matchType) {
            ruleErrors.push('At least one match type must be selected.');
        }

        //    b. At least one time slot selected
        if (rule.timeSlots.length === 0) {
            ruleErrors.push('At least one time slot must be selected.');
        }

        //    c. At least one battle mode selected
        if (Object.keys(rule.battleModes).length === 0) {
            ruleErrors.push('At least one battle mode must be selected.');
        }

        // If no battle modes are selected, we can't check maps, so skip map validation for this rule
        if (Object.keys(rule.battleModes).length > 0) {
            for (const modeId in rule.battleModes) {
                // Ensure map data exists for this mode before validating map-specific rules
                if (rule.maps && rule.maps[modeId]) {
                    const modeName = battleModesData[modeId] ? battleModesData[modeId].name : modeId;
                    const selectedMaps = rule.maps[modeId].selectedMaps;
                    const notifyType = rule.maps[modeId].notifyType;

                    // d. In each battle mode, at least one map selected
                    if (selectedMaps.length === 0) {
                        ruleErrors.push(`For battle mode "${modeName}", at least one map must be selected.`);
                    }

                    // e. "Notify me when 2 selected maps are in the same rotation" requires at least 2 maps
                    if (notifyType === 'two-same-rotation' && selectedMaps.length < 2) {
                        ruleErrors.push(`For battle mode "${modeName}", "Notify me when 2 selected maps are in the same rotation" requires at least 2 maps to be selected.`);
                    }
                }
            }
        }

        if (ruleErrors.length > 0) {
            errorMessage += `<h3>Errors in Notification Rule #${ruleNum}:</h3><ul>`;
            ruleErrors.forEach(err => {
                errorMessage += `<li>${err}</li>`;
            });
            errorMessage += `</ul>`;
            isValid = false; // Set overall form validity to false if any rule has errors
        }
    }); // Changed to iterate over collectedData.rules

    const responseDiv = document.getElementById('response');
    if (!isValid) {
        responseDiv.innerHTML = `<span style="color: red;"><span style="font-family: 'BlitzBold', sans-serif;">Form Validation Errors:</span><br>${errorMessage}</span>`;
        responseDiv.style.display = 'block'; // Show the response div for validation errors
        responseDiv.scrollIntoView({ behavior: 'smooth' });
    } else {
        // If validation passes, ensure the response div is hidden and cleared if no errors were found.
        // It will be shown later if there's a submission success/error.
        responseDiv.innerHTML = '';
        responseDiv.style.display = 'none';
    }

    return isValid;
}


let ruleCounter = 1;

function addAnotherRule(config = {}) {
    ruleCounter++;
    const container = document.getElementById('notification-rules-container');
    const newRuleSection = document.createElement('div');
    newRuleSection.className = 'form-section rule-section';
    newRuleSection.id = `rule-${ruleCounter}`;
    newRuleSection.innerHTML = `
        <h3 class="notification-rule-header">Notification Rule #${ruleCounter} <button type="button" class="delete-rule-button delete-icon-button" data-rule-id="${ruleCounter}" aria-label="Delete Rule">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px">
                <path d="M0 0h24v24H0z" fill="none"/>
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5L13.5 1S10.5 1 10.5 1H8.5L7 4H5v2h14V4z"/>
            </svg>
        </button></h3>

        <!-- User/Role Ping Syntax Dropdown -->
        <details class="user-role-ping-syntax">
            <summary>User/Role Ping Syntax</summary>
            <p>To ping a specific user, use the format <code><@USER_ID></code>, where <code>USER_ID</code> is the unique ID of the Discord user you want to mention. i.e. <code><@123456789012345678></code></p>
            <p>To ping a specific role, use the format <code><@&ROLE_ID></code>, where <code>ROLE_ID</code> is the unique ID of the Discord role. i.e. <code><@&987654321098765432></code></p>
            <p>To find these IDs, see <a href="https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID" target="_blank" rel="noopener noreferrer">this article</a>. You may have to enable developer mode.</p>
        </details>
        <br>

        <!-- Notification Message -->
        <label for="notificationMessage-${ruleCounter}" class="notification-message-label">Notification Message (max 300 characters):</label>
        <textarea id="notificationMessage-${ruleCounter}" name="notificationMessage-${ruleCounter}" class="notification-message-input" rows="4" maxlength="300" required>${config.notificationMessage || ''}</textarea>
        <br><br>

        <!-- Match Type -->
        <div id="match-type-selection-${ruleCounter}" class="match-type-selection-container">
            ${generateMatchTypeButton('Open', ruleCounter, config.matchType)}
            ${generateMatchTypeButton('Series', ruleCounter, config.matchType)}
            ${generateMatchTypeButton('X-Battle', ruleCounter, config.matchType)}
        </div>
        <br>

        <!-- Time Slots -->
        <!-- Label removed as per user request -->
        <div id="time-slots-${ruleCounter}">
            <!-- Time slots will be dynamically generated and converted to user's timezone -->
        </div>
        <br>

        <!-- Battle Modes -->
        <!-- Label removed as per user request -->
        <div id="battle-mode-selection-${ruleCounter}" class="battle-mode-selection-container">
            ${generateBattleModeButton('VnNSdWxlLTE=', 'Splat Zones', ruleCounter, config.battleModes)}
            ${generateBattleModeButton('VnNSdWxlLTI=', 'Tower Control', ruleCounter, config.battleModes)}
            ${generateBattleModeButton('VnNSdWxlLTM=', 'Rainmaker', ruleCounter, config.battleModes)}
            ${generateBattleModeButton('VnNSdWxlLTQ=', 'Clam Blitz', ruleCounter, config.battleModes)}
        </div>
        <br><br>

        <!-- Map Selectors (dynamically added per battle mode) -->
        <div id="map-selectors-container-${ruleCounter}">
            ${generateMapSelector('VnNSdWxlLTE=', 'Splat Zones', ruleCounter, config.maps ? config.maps['VnNSdWxlLTE='] : null)}
            ${generateMapSelector('VnNSdWxlLTI=', 'Tower Control', ruleCounter, config.maps ? config.maps['VnNSdWxlLTI='] : null)}
            ${generateMapSelector('VnNSdWxlLTM=', 'Rainmaker', ruleCounter, config.maps ? config.maps['VnNSdWxlLTM='] : null)}
            ${generateMapSelector('VnNSdWxlLTQ=', 'Clam Blitz', ruleCounter, config.maps ? config.maps['VnNSdWxlLTQ='] : null)}
        </div>
    `;
    container.appendChild(newRuleSection);

    // Generate time slots for the new section, populating if config.timeSlots exists
    const timeSlotsContainer = newRuleSection.querySelector(`#time-slots-${ruleCounter}`);
    generateTimeSlots(timeSlotsContainer, ruleCounter, config.timeSlots || []);

    // Attach event listeners for the new rule section
    const battleModeButtons = newRuleSection.querySelectorAll(`.battle-mode-button[data-rule-num="${ruleCounter}"]`);
    battleModeButtons.forEach(button => {
        button.addEventListener('click', handleBattleModeButtonClick);
        // Trigger click event to correctly show/hide map selectors if pre-populated
        if (button.classList.contains('selected')) {
            button.dispatchEvent(new Event('click'));
        }
    });

    // Add event listener for delete buttons
    newRuleSection.querySelector(`.delete-rule-button[data-rule-id="${ruleCounter}"]`).addEventListener('click', deleteRule);


    // Re-attach all dynamic listeners to include the new rule section and timeslot boxes
    attachDynamicListeners();

    // Update the section style for the newly added rule
    updateRuleSectionStyle(ruleCounter, config.matchType || null); // No default matchType selection, so no default color.
}

// Function to handle timeslot box clicks
function handleTimeslotBoxClick(event) {
    const timeslotBox = event.currentTarget;
    timeslotBox.classList.toggle('selected');
    // For validation, we might need a hidden input or rely solely on the 'selected' class.
    // Given collectFormData reads the 'selected' class directly, no hidden input is strictly necessary.
}

function deleteRule(event) {
    // Ensure event.currentTarget, which is the button, is used to get the dataset
    const clickedButton = event.currentTarget;
    const ruleId_to_delete = clickedButton.dataset.ruleId;
    const ruleSection = document.getElementById(`rule-${ruleId_to_delete}`);
    if (ruleSection) {
        ruleSection.remove();

        const remainingRules = document.querySelectorAll('.rule-section');
        let maxRuleId = 0; // To track the highest ruleId after re-numbering

        remainingRules.forEach((rule, index) => {
            const currentRuleId = parseInt(rule.id.split('-')[1]);
            const newRuleId = index + 1;
            rule.id = `rule-${newRuleId}`;
            const h3Element = rule.querySelector('h3.notification-rule-header');
            if (h3Element) {
                // Update text content for rule number and ensure button is preserved
                const textNode = Array.from(h3Element.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
                if (textNode) {
                    textNode.nodeValue = `Notification Rule #${newRuleId} `; // Update only the text node
                }

                const deleteButton = h3Element.querySelector('.delete-rule-button');
                if (deleteButton) {
                    deleteButton.dataset.ruleId = newRuleId;
                    // Re-attach event listener for the updated delete button
                    deleteButton.removeEventListener('click', deleteRule);
                    deleteButton.addEventListener('click', deleteRule);
                }
            }
            
            // Update all name attributes dynamically
            rule.querySelectorAll('[name]').forEach(input => {
                const oldName = input.name;
                // Regex to replace the rule number while keeping the rest of the name
                input.name = oldName.replace(/-\d+$/, `-${newRuleId}`);
            });

            // Update all id attributes dynamically
            rule.querySelectorAll('[id]').forEach(element => {
                const oldId = element.id;
                // Regex to replace the rule number at the end of the id
                element.id = oldId.replace(/-\d+$/, `-${newRuleId}`);
            });

            // Update data-rule-id on delete button
            const deleteButton = rule.querySelector('.delete-rule-button');
            if (deleteButton) {
                deleteButton.dataset.ruleId = newRuleId;
                // Re-attach event listener for the updated delete button
                deleteButton.removeEventListener('click', deleteRule);
                deleteButton.addEventListener('click', deleteRule);
            }
            maxRuleId = Math.max(maxRuleId, newRuleId);
        });

        ruleCounter = maxRuleId; // Update global counter to the current highest rule number

        // If no rules are left, set ruleCounter to 0
        if (remainingRules.length === 0) {
            ruleCounter = 0;
        }

        attachDynamicListeners(); // Re-attach listeners after re-numbering all rules
    }
}

async function fetchMapsData() {
    try {
        const response = await fetch('maps.json');
        mapsData = await response.json();
    } catch (error) {
        console.error('Error fetching maps.json:', error);
    }
}

async function fetchBattleModesData() {
    try {
        const response = await fetch('batle-modes.json');
        const data = await response.json();
        // Add icon paths to battleModesData
        for (const modeId in data) {
            if (data.hasOwnProperty(modeId)) {
                data[modeId].icon = `${modeId}.svg`; // Assuming SVG filenames are modeId.svg
            }
        }
        battleModesData = data;
    } catch (error) {
        console.error('Error fetching batle-modes.json:', error);
    }
}

function generateMatchTypeButton(matchType, ruleNum, selectedMatchType) {
    const isSelected = selectedMatchType === matchType;
    let iconPath = '';
    let matchTypeClass = matchType.toLowerCase();

    if (matchType === 'Open' || matchType === 'Series') {
        iconPath = 'assets/Anarchy.svg';
    } else if (matchType === 'X-Battle') {
        iconPath = 'assets/X-Battle.svg';
    }

    return `
        <button type="button"
                class="match-type-button ${matchTypeClass} ${isSelected ? 'selected' : ''}"
                data-match-type="${matchType}"
                data-rule-num="${ruleNum}">
            ${iconPath ? `<img src="${iconPath}" alt="${matchType} Icon" class="match-type-button-icon">` : ''}
            <span>${matchType}</span>
        </button>
    `;
}

function generateBattleModeButton(modeId, modeName, ruleNum, selectedBattleModes) {
    const isSelected = selectedBattleModes && selectedBattleModes[modeId];
    const iconPath = battleModesData[modeId] && battleModesData[modeId].icon ? `assets/${battleModesData[modeId].icon}` : '';

    return `
        <button type="button"
                class="battle-mode-button ${isSelected ? 'selected' : ''}"
                data-mode-id="${modeId}"
                data-rule-num="${ruleNum}">
            ${iconPath ? `<img src="${iconPath}" alt="${modeName} Icon" class="battle-mode-button-icon">` : ''}
            <span>${modeName}</span>
        </button>
    `;
}

function generateMapSelector(modeId, modeName, ruleNum, mapConfig) {
    const notifyType = mapConfig ? mapConfig.notifyType : 'at-least-one';
    const selectedMaps = mapConfig ? mapConfig.selectedMaps : [];

    let mapItemsHtml = '';
    // Iterate over the mapsData object to create map checkboxes
    for (const mapBase64Id in mapsData) {
        if (mapsData.hasOwnProperty(mapBase64Id)) {
            const mapName = mapsData[mapBase64Id].name;
            mapItemsHtml += generateMapItem(mapBase64Id, mapName, modeId, ruleNum, selectedMaps);
        }
    }

    // Determine initial visibility. If there are no maps configured, it should be hidden.
    // If mapConfig exists and has notifyType or selectedMaps, it should be visible.
    const isHidden = !selectedMaps.length && !mapConfig;

    return `
        <div class="map-selector ${isHidden ? 'hidden' : ''}" id="map-selector-${modeId}-${ruleNum}">
            <h4 class="map-selector-header">
                ${battleModesData[modeId] && battleModesData[modeId].icon ? `<img src="assets/${battleModesData[modeId].icon}" alt="${modeName} Icon" class="battle-mode-header-icon">` : ''}
                Maps for ${modeName}
            </h4>
            <div class="notify-type-selection-container">
                <div class="notify-type-button ${notifyType === 'at-least-one' ? 'selected' : ''}" data-notify-type="at-least-one" data-mode-id="${modeId}" data-rule-num="${ruleNum}">
                    Notify me when rotation includes at least one selected map
                </div>
                <div class="notify-type-button ${notifyType === 'two-same-rotation' ? 'selected' : ''}" data-notify-type="two-same-rotation" data-mode-id="${modeId}" data-rule-num="${ruleNum}">
                    Notify me when 2 selected maps are in the same rotation
                </div>
            </div>
            <div class="map-list">
                ${mapItemsHtml}
            </div>
        </div>
    `;
}

function generateMapItem(mapBase64Id, mapName, modeId, ruleNum, selectedMaps) {
    const isSelected = selectedMaps.includes(mapBase64Id) ? 'selected' : '';
    const imageUrl = `assets/${mapBase64Id}.png`;
    
    // Get the battle mode icon path from battleModesData
    const battleModeIconPath = battleModesData[modeId] && battleModesData[modeId].icon ? `assets/${battleModesData[modeId].icon}` : '';

    return `
        <div class="map-item ${isSelected}" data-map-id="${mapBase64Id}" data-mode-id="${modeId}" data-rule-num="${ruleNum}">
            <input type="hidden" name="map-${modeId}-${ruleNum}" value="${mapBase64Id}" ${isSelected ? 'checked' : ''} class="map-checkbox-hidden">
            <div class="map-item-content">
                <img src="${imageUrl}" alt="${mapName}">
                ${battleModeIconPath ? `
                <div class="battle-mode-icon-container">
                    <img src="${battleModeIconPath}" alt="${battleModesData[modeId].name} Icon" class="battle-mode-icon">
                </div>
                ` : ''}
                <figcaption class="map-caption">${mapName}</figcaption>
            </div>
        </div>
    `;
}

function handleMapItemClick(event) {
    const mapItem = event.currentTarget;
    mapItem.classList.toggle('selected');
    const hiddenCheckbox = mapItem.querySelector('.map-checkbox-hidden');
    const mapId = mapItem.dataset.mapId;
    const modeId = mapItem.dataset.modeId;
    const ruleNum = mapItem.dataset.ruleNum;
    if (hiddenCheckbox) {
        hiddenCheckbox.checked = mapItem.classList.contains('selected');
    }
}

// Re-attach map item click listeners
function attachMapItemListeners(ruleNum) {
    const mapSelectorsContainer = document.getElementById(`map-selectors-container-${ruleNum}`);
    if (mapSelectorsContainer) {
        mapSelectorsContainer.querySelectorAll('.map-item').forEach(mapItem => {
            mapItem.removeEventListener('click', handleMapItemClick); // Prevent duplicate listeners
            mapItem.addEventListener('click', handleMapItemClick);
        });
    }
}

// --- JSON Loading and Population (Simulated) ---
// This function would be called after the hx-get="/load-config" successfully fetches data.
function populateFormWithJSON(rulesConfig) {
    // The webhook URL should NOT be touched by this function.
    // It's handled by the check-webhook event listener directly.

    const notificationRulesContainer = document.getElementById('notification-rules-container');
    
    // Clear all existing rule sections
    notificationRulesContainer.innerHTML = '';
    ruleCounter = 0; // Reset counter for a clean rebuild

    if (!rulesConfig || rulesConfig.length === 0) {
        // If no rules in config, add one empty rule.
        addAnotherRule({});
    } else {
        rulesConfig.forEach(ruleConfig => {
            addAnotherRule(ruleConfig);
            const currentRuleNum = ruleCounter;
            if (ruleConfig.matchType) {
                const matchTypeButton = document.querySelector(`.match-type-button[data-rule-num="${currentRuleNum}"][data-match-type="${ruleConfig.matchType}"]`);
                if (matchTypeButton) {
                    matchTypeButton.classList.add('selected', ruleConfig.matchType.toLowerCase());
                }
            }
            updateRuleSectionStyle(currentRuleNum, ruleConfig.matchType || null);

            if (ruleConfig.battleModes) {
                for (const modeId in ruleConfig.battleModes) {
                    if (ruleConfig.battleModes[modeId]) {
                        const button = document.querySelector(`.battle-mode-button[data-rule-num="${currentRuleNum}"][data-mode-id="${modeId}"]`);
                        if (button) {
                            button.dispatchEvent(new Event('click'));

                            if (ruleConfig.maps && ruleConfig.maps[modeId] && ruleConfig.maps[modeId].notifyType) {
                                const notifyType = ruleConfig.maps[modeId].notifyType;
                                const notifyButton = document.querySelector(`.notify-type-button[data-rule-num="${currentRuleNum}"][data-mode-id="${modeId}"][data-notify-type="${notifyType}"]`);
                                if (notifyButton) {
                                    notifyButton.dispatchEvent(new Event('click'));
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    document.getElementById('main-form-container').classList.remove('hidden');
    isWebhookValidated = true;

    attachDynamicListeners();
}

// HTMX related comments and simulation blocks have been removed as HTMX is no longer used for form submission.
