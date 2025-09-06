package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Config represents the overall structure of the form configuration
type Config struct {
	WebhookURL string `json:"webhookUrl"`
	Rules      []Rule `json:"rules"`
}

// Rule represents a single notification rule
type Rule struct {
	NotificationMessage string            `json:"notificationMessage"`
	MatchType           string            `json:"matchType"`
	TimeSlots           []string          `json:"timeSlots"`
	BattleModes         map[string]bool   `json:"battleModes"` // Changed to map[string]bool
	Maps                map[string]MapSet `json:"maps"`
}

// MapSet defines the notification type and selected maps for a specific battle mode
type MapSet struct {
	NotifyType   string   `json:"notifyType"`
	SelectedMaps []string `json:"selectedMaps"`
}

// Global variable to store the last submitted configuration
var currentConfig = Config{
	WebhookURL: "http://localhost:8080/webhook", // Default webhook URL
	Rules: []Rule{
		{
			MatchType:   "Open",
			TimeSlots:   []string{"00:00-02:00 UTC", "04:00-06:00 UTC"},
			BattleModes: map[string]bool{"Splat Zones": true},
			Maps: map[string]MapSet{
				"Splat Zones": {
					NotifyType:   "at-least-one",
					SelectedMaps: []string{"Walleye Warehouse"},
				},
			},
		},
	},
}

func main() {
	// Serve static files (index.html, CSS, JS)
	http.Handle("/", http.FileServer(http.Dir(".")))

	// Endpoint to check webhook URL
	http.HandleFunc("/check-webhook-url", checkWebhookURLHandler)
	// Endpoint to load configuration
	http.HandleFunc("/load-config", loadConfigHandler)
	// Endpoint to submit configuration
	http.HandleFunc("/submit-config", submitConfigHandler)

	port := ":8080"
	fmt.Printf("Server starting on port %s\n", port)
	log.Fatal(http.ListenAndServe(port, nil))
}

func checkWebhookURLHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received request to /check-webhook-url")
	w.Header().Set("Content-Type", "application/json")

	webhookURL := r.URL.Query().Get("webhookUrl")
	response := make(map[string]interface{})

	if webhookURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		response["isValid"] = false
		response["error"] = "Webhook URL cannot be empty!"
		json.NewEncoder(w).Encode(response)
		return
	}

	// Basic URL format validation for a mock
	if !(len(webhookURL) > 7 && (webhookURL[:7] == "http://" || webhookURL[:8] == "https://")) {
		w.WriteHeader(http.StatusBadRequest)
		response["isValid"] = false
		response["error"] = "Invalid Webhook URL format (must start with http:// or https://)"
		json.NewEncoder(w).Encode(response)
		return
	}

	w.WriteHeader(http.StatusOK)
	response["isValid"] = true
	response["message"] = "Webhook URL is valid!"
	json.NewEncoder(w).Encode(response)
}

func loadConfigHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received request to /load-config")
	w.Header().Set("Content-Type", "application/json")

	// Simulate delay for API call
	time.Sleep(500 * time.Millisecond)

	json.NewEncoder(w).Encode(currentConfig)
}

func submitConfigHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received request to /submit-config")
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "Only POST method is allowed"})
		return
	}

	var newConfig Config
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&newConfig); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Error parsing request body: " + err.Error()})
		return
	}

	// Update the global configuration
	currentConfig = newConfig

	log.Printf("Configuration saved: %+v\n", currentConfig)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(currentConfig)
}
