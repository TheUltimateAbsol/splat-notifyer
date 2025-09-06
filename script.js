let initialWebhookUrl = document.getElementById('webhook-url').value; // Store initial webhook URL
let isWebhookValidated = false; // Track webhook validation status

// Client-side JavaScript for handling timezone conversion and dynamic form elements

// Function to generate time slots (moved to global scope)
function generateTimeSlots(container, ruleNum, selectedSlots = []) {
    container.innerHTML = ''; // Clear existing
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
            timeValue: `${hour.toString().padStart(2, '0')}:00-${((hour + 2) % 24).toString().padStart(2, '0')}:00 UTC`, // Keep UTC values for backend
        });
    }

    // Sort time slots: 11 PM (23:00) first, 10 PM (22:00) last.
    timeSlotData.sort((a, b) => {
        const hourA = a.localStart.getHours();
        const hourB = b.localStart.getHours();

        // Custom sorting logic for 11 PM first, 10 PM last
        if (hourA === 23) return -1; // 11 PM (23:00) comes first
        if (hourB === 23) return 1;

        if (hourA === 22) return 1; // 10 PM (22:00) comes last
        if (hourB === 22) return -1;

        return hourA - hourB; // Otherwise, sort normally by hour
    });

    // Function to format hour to 12-hour format
    const formatTo12Hour = (date) => {
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours === 0 ? 12 : hours; // the hour '0' should be '12'
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    };

    // Get the local timezone abbreviation
    const timezoneAbbr = new Date().toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ').pop();

    // Generate HTML for sorted time slots
    timeSlotData.forEach(slot => {
        const displayStartTime = formatTo12Hour(slot.localStart);
        const displayEndTime = formatTo12Hour(slot.localEnd);

        const displayTime = `${displayStartTime} - ${displayEndTime} ${timezoneAbbr}`;
        const isChecked = selectedSlots.includes(slot.timeValue) ? 'checked' : '';

        container.innerHTML += `
            <input type="checkbox" name="timeSlot-${ruleNum}" value="${slot.timeValue}" ${isChecked}> ${displayTime}<br>
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

        // Battle mode checkboxes for new sections
        const battleModeCheckboxes = ruleSection.querySelectorAll(`input[name^="battleMode-${ruleNum}"]`);
        battleModeCheckboxes.forEach(checkbox => {
            checkbox.removeEventListener('change', handleBattleModeChange); // Prevent duplicate listeners
            checkbox.addEventListener('change', handleBattleModeChange);
        });
    });
}

// Hide/show map selectors based on battle mode checkboxes (moved to global scope)
function handleBattleModeChange(e) {
    const ruleNum = this.name.split('-')[1];
    const mode = e.target.value.toLowerCase().replace(' ', '-');
    const mapSelectorsContainer = document.getElementById(`map-selectors-container-${ruleNum}`);
    let mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${mode}-${ruleNum}`);

    if(e.target.checked && !mapSelector) {
        // If map selector doesn't exist and checkbox is checked, generate and append it
        const modeName = e.target.value;
        mapSelectorsContainer.insertAdjacentHTML('beforeend', generateMapSelector(modeName, ruleNum, null));
        // Get the newly added map selector
        mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${mode}-${ruleNum}`);
    }

    if (mapSelector) {
        mapSelector.classList.toggle('hidden', !e.target.checked);
    }
}

document.addEventListener('DOMContentLoaded', (event) => {
    // Initial call to generate time slots for the first rule and attach listeners
    generateTimeSlots(document.getElementById('time-slots-1'), 1);
    attachDynamicListeners(); // Attach for initial form (e.g., battle mode toggles)

    // "Add Another" button functionality
    document.getElementById('add-another-rule').addEventListener('click', addAnotherRule);

    // Attach event listener for the delete button of the initial rule #1
    const initialDeleteButton = document.querySelector('.rule-section#rule-1 .delete-rule-button');
    if (initialDeleteButton) {
        initialDeleteButton.addEventListener('click', deleteRule);
    }

    document.getElementById('check-webhook').addEventListener('click', async () => {
        const webhookUrlInput = document.getElementById('webhook-url');
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
            const response = await fetch(`/check-webhook-url?webhookUrl=${encodeURIComponent(webhookUrl)}`);
            const data = await response.json(); // Assuming the backend returns JSON
            
            if (response.ok && data.isValid) {
                webhookFeedback.innerHTML = '<span style="color: green;">Webhook URL is valid.</span>';
                webhookFeedback.style.color = 'green';
                document.getElementById('main-form-container').classList.remove('hidden');
                isWebhookValidated = true;
                initialWebhookUrl = webhookUrl; // Update initial URL upon successful validation

                // Now load config if webhook is valid
                console.log('Fetching /load-config after webhook validation.');
                const configResponse = await fetch('/load-config');
                const configData = await configResponse.json();
                if (configResponse.ok) {
                    populateFormWithJSON(configData);
                } else {
                    console.error('Error loading config:', configData);
                    // Optionally display an error for config loading
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
    //     console.log('HTMX: Generic afterSwap detected, target:', e.detail.target.id || e.detail.target.tagName, 'url:', e.detail.xhr.responseURL);
    // });



});

// The hx-on::after-request on #main-form-container now handles calling populateFormWithJSON
// So this simulation block is no longer needed.

document.getElementById('main-submit-button').addEventListener('click', async (event) => {
    event.preventDefault(); // Prevent default form submission

    if (!validateForm()) {
        console.log('Form validation failed. Preventing JSON submission.');
        return;
    }

    const formData = collectFormData();
    const jsonPayload = JSON.stringify(formData);
    console.log('Collected Form Data JSON Payload SENT:', jsonPayload); // Re-adding for transparency based on previous user input

    try {
        const response = await fetch('/submit-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: jsonPayload,
        });

        const result = await response.json();
        const responseDiv = document.getElementById('response');
        if (response.ok) {
            responseDiv.innerHTML = `<div style="color: green;">Configuration submitted successfully: <pre>${JSON.stringify(result, null, 2)}</pre></div>`;
            console.log('Configuration submitted successfully:', result);
        } else {
            responseDiv.innerHTML = `<div style="color: red;">Error submitting configuration: <pre>${JSON.stringify(result, null, 2)}</pre></div>`;
            console.error('Error submitting configuration:', result);
        }
        responseDiv.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        const responseDiv = document.getElementById('response');
        responseDiv.innerHTML = `<div style="color: red;">Network error: ${error.message}</div>`;
        responseDiv.scrollIntoView({ behavior: 'smooth' });
        console.error('Network error:', error);
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

        const notificationMessageInput = ruleSection.querySelector(`input[name="notificationMessage-${ruleNum}"]`);
        if (notificationMessageInput) {
            rule.notificationMessage = notificationMessageInput.value;
        }
        // The 'required' attribute on the input, combined with validateForm(),
        // ensures this field will always have a non-empty value if the form is submitted.
        // If notificationMessageInput is null, it indicates a structural HTML issue.

        rule.matchType = ruleSection.querySelector(`select[name="matchType-${ruleNum}"]`).value;
        rule.timeSlots = [];
        rule.battleModes = {}; // Initialize as an object rather than array to store true/false
        rule.maps = {};

        // Collect time slots
        ruleSection.querySelectorAll(`input[name="timeSlot-${ruleNum}"]:checked`).forEach(checkbox => {
            rule.timeSlots.push(checkbox.value);
        });

        // Collect battle modes and associated maps/notify types
        const checkedBattleModeCheckboxes = ruleSection.querySelectorAll(`input[name="battleMode-${ruleNum}"]:checked`);
        checkedBattleModeCheckboxes.forEach(checkbox => {
            const modeName = checkbox.value;
            const modeId = modeName.toLowerCase().replace(' ', '-');
            rule.battleModes[modeName] = true; // Mark as selected

            const mapSelectorsContainer = document.getElementById(`map-selectors-container-${ruleNum}`);
            const mapSelector = mapSelectorsContainer.querySelector(`#map-selector-${modeId}-${ruleNum}`);
             
            // Only collect map data if the map selector is visible
            if (mapSelector && !mapSelector.classList.contains('hidden')) {
                const selectedMaps = [];
                mapSelector.querySelectorAll(`input[name="map-${modeId}-${ruleNum}"]:checked`).forEach(mapCheckbox => {
                    selectedMaps.push(mapCheckbox.value);
                });

                const notifyTypeElement = mapSelector.querySelector(`input[name="map-notify-type-${modeId}-${ruleNum}"]:checked`);
                const notifyType = notifyTypeElement ? notifyTypeElement.value : 'at-least-one'; // Default if none checked

                rule.maps[modeName] = {
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
    console.log('validateForm() called');
    let isValid = true;
    let errorMessage = '';

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


    // 2. At least one notification rule
    const ruleSections = document.querySelectorAll('.rule-section');
    if (ruleSections.length === 0) {
        errorMessage += 'There must be at least one notification rule.<br>';
        isValid = false;
    }

    ruleSections.forEach((ruleSection, index) => {
        const ruleNum = parseInt(ruleSection.id.split('-')[1]);
        let ruleErrors = [];

        // Validate Notification Message
        const notificationMessageInput = ruleSection.querySelector(`input[name="notificationMessage-${ruleNum}"]`);
        if (!notificationMessageInput.value.trim()) {
            ruleErrors.push('Notification Message cannot be empty.');
        }

        // 3. In each notification rule:
        //    a. At least one time slot selected
        const timeSlots = ruleSection.querySelectorAll(`input[name="timeSlot-${ruleNum}"]:checked`);
        if (timeSlots.length === 0) {
            ruleErrors.push('At least one time slot must be selected.');
        }

        //    b. At least one battle mode selected
        const battleModes = ruleSection.querySelectorAll(`input[name="battleMode-${ruleNum}"]:checked`);
        if (battleModes.length === 0) {
            ruleErrors.push('At least one battle mode must be selected.');
        }

        // If no battle modes are selected, we can't check maps, so skip map validation for this rule
        if (battleModes.length > 0) {
            battleModes.forEach(battleModeCheckbox => {
                const modeName = battleModeCheckbox.value;
                const modeId = modeName.toLowerCase().replace(' ', '-');
                const mapSelector = document.getElementById(`map-selector-${modeId}-${ruleNum}`);

                if (mapSelector && !mapSelector.classList.contains('hidden')) { // Only validate if map selector is visible
                    // c. In each battle mode, at least one map selected
                    const selectedMaps = mapSelector.querySelectorAll(`input[name="map-${modeId}-${ruleNum}"]:checked`);
                    if (selectedMaps.length === 0) {
                        ruleErrors.push(`For battle mode "${modeName}", at least one map must be selected.`);
                    }

                    // d. "Notify me when 2 selected maps are in the same rotation" cannot be specified if there is only 1 map selected
                    const notifyTypeTwoSameRotation = mapSelector.querySelector(`input[name="map-notify-type-${modeId}-${ruleNum}"][value="two-same-rotation"]:checked`);
                    if (notifyTypeTwoSameRotation && selectedMaps.length === 1) {
                        ruleErrors.push(`For battle mode "${modeName}", "Notify me when 2 selected maps are in the same rotation" cannot be chosen if only 1 map is selected.`);
                    }
                }
            });
        }

        if (ruleErrors.length > 0) {
            errorMessage += `<h3>Errors in Notification Rule #${ruleNum}:</h3><ul>`;
            ruleErrors.forEach(err => {
                errorMessage += `<li>${err}</li>`;
            });
            errorMessage += `</ul>`;
            isValid = false;
        }
    });

    const responseDiv = document.getElementById('response');
    if (!isValid) {
        responseDiv.innerHTML = `<div style="color: red;">${errorMessage}</div>`;
        responseDiv.scrollIntoView({ behavior: 'smooth' });
    } else {
        responseDiv.innerHTML = ''; // Clear previous errors
    }

    console.log('validateForm() returning:', isValid);
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
        <h3>Notification Rule #${ruleCounter} <button type="button" class="delete-rule-button" data-rule-id="${ruleCounter}">Delete</button></h3>

        <!-- User/Role Ping Syntax Dropdown -->
        <details class="user-role-ping-syntax">
            <summary>User/Role Ping Syntax</summary>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
        </details>
        <br>

        <!-- Notification Message -->
        <label for="notificationMessage-${ruleCounter}">Notification Message:</label>
        <input type="text" id="notificationMessage-${ruleCounter}" name="notificationMessage-${ruleCounter}" size="50" required value="${config.notificationMessage || ''}">
        <br><br>

        <!-- Match Type -->
        <label>Match Type:</label>
        <select name="matchType-${ruleCounter}">
            <option value="Open" ${config.matchType === 'Open' ? 'selected' : ''}>Open</option>
            <option value="Series" ${config.matchType === 'Series' ? 'selected' : ''}>Series</option>
            <option value="X-Battle" ${config.matchType === 'X-Battle' ? 'selected' : ''}>X-Battle</option>
        </select>
        <br><br>

        <!-- Time Slots -->
        <label>Time Slots:</label><br>
        <div id="time-slots-${ruleCounter}">
            <!-- Time slots will be dynamically generated and converted to user's timezone -->
        </div>
        <br>

        <!-- Battle Modes -->
        <label>Battle Modes:</label><br>
        <input type="checkbox" name="battleMode-${ruleCounter}" value="Splat Zones" ${config.battleModes && config.battleModes['Splat Zones'] ? 'checked' : ''}> Splat Zones
        <input type="checkbox" name="battleMode-${ruleCounter}" value="Tower Control" ${config.battleModes && config.battleModes['Tower Control'] ? 'checked' : ''}> Tower Control
        <input type="checkbox" name="battleMode-${ruleCounter}" value="Turf War" ${config.battleModes && config.battleModes['Turf War'] ? 'checked' : ''}> Turf War
        <input type="checkbox" name="battleMode-${ruleCounter}" value="Clam Blitz" ${config.battleModes && config.battleModes['Clam Blitz'] ? 'checked' : ''}> Clam Blitz
        <br><br>

        <!-- Map Selectors (dynamically added per battle mode) -->
        <div id="map-selectors-container-${ruleCounter}">
            ${generateMapSelector('Splat Zones', ruleCounter, config.maps ? config.maps['Splat Zones'] : null)}
            ${generateMapSelector('Tower Control', ruleCounter, config.maps ? config.maps['Tower Control'] : null)}
            ${generateMapSelector('Turf War', ruleCounter, config.maps ? config.maps['Turf War'] : null)}
            ${generateMapSelector('Clam Blitz', ruleCounter, config.maps ? config.maps['Clam Blitz'] : null)}
        </div>
    `;
    container.appendChild(newRuleSection);

    // Generate time slots for the new section, populating if config.timeSlots exists
    const timeSlotsContainer = newRuleSection.querySelector(`#time-slots-${ruleCounter}`);
    generateTimeSlots(timeSlotsContainer, ruleCounter, config.timeSlots || []);

    // Attach event listeners for the new rule section
    const battleModeCheckboxes = newRuleSection.querySelectorAll(`input[name^="battleMode-${ruleCounter}"]`);
    battleModeCheckboxes.forEach(checkbox => {
        // Trigger change event to correctly show/hide map selectors if pre-populated
        if (checkbox.checked) {
            checkbox.dispatchEvent(new Event('change'));
        }
    });

    // Add event listener for delete buttons
    newRuleSection.querySelector(`.delete-rule-button[data-rule-id="${ruleCounter}"]`).addEventListener('click', deleteRule);

    // Re-attach all dynamic listeners to include the new rule section
    attachDynamicListeners();
}

function deleteRule(event) {
    const ruleId_to_delete = event.target.dataset.ruleId; // Use a different var name to avoid confusion
    const ruleSection = document.getElementById(`rule-${ruleId_to_delete}`);
    if (ruleSection) {
        ruleSection.remove();

        const remainingRules = document.querySelectorAll('.rule-section');
        let maxRuleId = 0; // To track the highest ruleId after re-numbering

        remainingRules.forEach((rule, index) => {
            const currentRuleId = parseInt(rule.id.split('-')[1]);
            const newRuleId = index + 1;
            rule.id = `rule-${newRuleId}`;
            rule.querySelector('h3').innerHTML = `Notification Rule #${newRuleId} <button type="button" class="delete-rule-button" data-rule-id="${newRuleId}">Delete</button></h3>`;
            
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

function generateMapSelector(modeName, ruleNum, mapConfig) {
    const modeId = modeName.toLowerCase().replace(' ', '-');
    const notifyType = mapConfig ? mapConfig.notifyType : 'at-least-one';
    const selectedMaps = mapConfig ? mapConfig.selectedMaps : [];

    return `
        <div class="map-selector ${!selectedMaps.length && (!mapConfig || !mapConfig.notifyType) ? 'hidden' : ''}" id="map-selector-${modeId}-${ruleNum}">
            <h4>Maps for ${modeName}</h4>
            <div>
                <input type="radio" name="map-notify-type-${modeId}-${ruleNum}" value="at-least-one" ${notifyType === 'at-least-one' ? 'checked' : ''}> Notify me when rotation includes at least one selected map
                <input type="radio" name="map-notify-type-${modeId}-${ruleNum}" value="two-same-rotation" ${notifyType === 'two-same-rotation' ? 'checked' : ''}> Notify me when 2 selected maps are in the same rotation
            </div>
            <div class="map-list">
                ${generateMapItem('Walleye Warehouse', modeId, ruleNum, selectedMaps)}
                ${generateMapItem('Myrtle Beach', modeId, ruleNum, selectedMaps)}
                ${generateMapItem('Walmart', modeId, ruleNum, selectedMaps)}
            </div>
        </div>
    `;
}

function generateMapItem(mapName, modeId, ruleNum, selectedMaps) {
    const isChecked = selectedMaps.includes(mapName) ? 'checked' : '';
    const imageUrl = `https://via.placeholder.com/150x100?text=${encodeURIComponent(mapName)}`;
    return `
        <div class="map-item">
            <input type="checkbox" name="map-${modeId}-${ruleNum}" value="${mapName}" ${isChecked}>
            <img src="${imageUrl}" alt="${mapName}">
            <figcaption>${mapName}</figcaption>
        </div>
    `;
}

// --- JSON Loading and Population (Simulated) ---
// This function would be called after the hx-get="/load-config" successfully fetches data.
function populateFormWithJSON(jsonData) {
    console.log('populateFormWithJSON called with data:', jsonData);
    const webhookUrlInput = document.getElementById('webhook-url');
    webhookUrlInput.value = jsonData.webhookUrl || '';
    initialWebhookUrl = webhookUrlInput.value; // Reset initial URL for change detection

    // Remove existing rule sections except the first one (if it's empty/default)
    const notificationRulesContainer = document.getElementById('notification-rules-container');
    while (notificationRulesContainer.children.length > 1) {
        notificationRulesContainer.removeChild(notificationRulesContainer.lastChild);
    }
    // Clear or hide the first rule if new ones are coming
    if (jsonData.rules && jsonData.rules.length > 0) {
         // Clear the content of the first rule to be repopulated or replaced
        // For simplicity, we'll assume the first rule will be overwritten or removed
        // by the dynamic adding of rules from JSON, so we'll just increment ruleCounter.
        // If the first rule should be treated specially, more complex logic is needed.
        notificationRulesContainer.innerHTML = '';
        ruleCounter = 0; // Reset counter for clean rebuild
    }


    if (jsonData.rules && jsonData.rules.length > 0) {
        jsonData.rules.forEach(ruleConfig => {
            addAnotherRule(ruleConfig); // Use the existing 'addAnotherRule' to create and populate
        });
    } else {
        // If no rules in JSON, ensure at least one empty rule exists (or keep the default one)
        if (notificationRulesContainer.children.length === 0) {
            addAnotherRule({});
        }
    }

    // Ensure the main form container is visible if a webhook URL is present
    if (jsonData.webhookUrl) {
        document.getElementById('main-form-container').classList.remove('hidden');
        document.getElementById('webhook-feedback').innerHTML = '&nbsp;'; // Clear feedback
        isWebhookValidated = true; // Assume webhook is validated if URL is present in loaded config
    } else {
        document.getElementById('main-form-container').classList.add('hidden');
        isWebhookValidated = false; // Not validated if no URL
    }

    // After populating, re-attach all dynamic listeners for all rules
    attachDynamicListeners();
}

// HTMX related comments and simulation blocks have been removed as HTMX is no longer used for form submission.

