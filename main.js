//
// Global variables for Google Maps, StreetView, and conversation
//@ts-nocheck
let map, streetView, animatedMarker;
const NYC_BOUNDS = {
  north: 41.0,    // Extended north to include more of the Bronx
  south: 40.4,    // Extended south to include more of Staten Island
  west: -74.3,    // Extended west to include more of New Jersey connections
  east: -73.5     // Extended east to include more of Long Island
};

// Global conversation variables
let isConversationView = false;
let isConversationPaused = false;
let conversationTimeout;
let conversationHistory = [];
let currentRouteInfo = null;

// Replace the speech synthesis variables with Google TTS variables
let isSpeaking = false;
let audioContext = null;
let audioQueue = [];
let isProcessingQueue = false;

// Add these variables at the top with other globals
let isTTSInitialized = false;
let ttsInitPromise = null;

// Global variables for route progression
let routeData = [];
let currentRoute = [];
let currentLocationIndex = 0;
let isJourneyActive = false;
let isAnimating = false;
let animationTimeout;

// Add CoT data handling
let cotData = [];
let currentCotIndex = 0;

// Add this at the top with other global variables
let currentJourneyDetails = null;

// Add this at the top with other global variables
let lastProcessedLocation = null;

// Add at the top with other global variables
let isTTSComplete = true;
let pendingConversation = false;

// Track which agent should speak next
let nextAgentToSpeak = "Agent1";
// Interval ID used to nudge the Street View panorama so it continues rendering while covered
let streetViewRefreshInterval = null;
// When true, prevent updateStreetView from changing the live panorama (freeze for conversation)
let freezeStreetView = false;

//
// 1. Initialize the map and Street View
//

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 12,
    center: { lat: 40.7128, lng: -74.0060 },
    restriction: {
      latLngBounds: NYC_BOUNDS,
      strictBounds: false,
    },
    mapTypeId: google.maps.MapTypeId.ROADMAP
  });
  streetView = new google.maps.StreetViewPanorama(document.getElementById("street-view"), {
    position: { lat: 40.7128, lng: -74.0060 },
    pov: { heading: 165, pitch: 0 },
    zoom: 1
  });
  map.setStreetView(streetView);
  
  // Load both route data and CoT data
  loadRouteData();
  loadCotData();
}

//
// 2. Handle route input: start + end addresses
//
function handleRoute() {
  const start = document.getElementById("start").value;
  const finalDestination = document.getElementById("final-destination").value;
  
  if (!start || !finalDestination) {
    alert("Please select both initial start location and final destination!");
    return;
  }

  if (findRoute(start, finalDestination)) {
    isJourneyActive = true;
    // Start with the first segment
    const firstEnd = currentRoute[1];
    checkLocationInNYC(start, firstEnd);
    
    // Update journey display
    updateJourneyDisplay();
    
    // Add initial journey information to conversation history
    conversationHistory.push({
      role: "system",
      content: `User has selected a new journey:
      - Origin: ${start}
      - Destination: ${finalDestination}
      - Complete Route: ${currentRoute.join(' → ')}
      - Intermediate Locations: ${currentRoute.slice(1, -1).join(', ')}`
    });
  } else {
    alert("No valid route found between these locations!");
  }
}

function checkLocationInNYC(start, end) {
  console.log('Attempting to geocode start address:', start);
  const geocoder = new google.maps.Geocoder();
  
  // Add "New York City" to the addresses if not already present
  const startAddress = start.toLowerCase().includes('new york') ? start : `${start}, New York City`;
  const endAddress = end.toLowerCase().includes('new york') ? end : `${end}, New York City`;
  
  geocoder.geocode({ address: startAddress }, function (startResults, startStatus) {
    console.log('Start address geocoding status:', startStatus);
    console.log('Start address results:', startResults);
    if (startStatus === google.maps.GeocoderStatus.OK) {
      const startLocation = startResults[0].geometry.location;
      console.log('Start location:', startLocation.lat(), startLocation.lng());
      geocoder.geocode({ address: endAddress }, function (endResults, endStatus) {
        console.log('End address geocoding status:', endStatus);
        console.log('End address results:', endResults);
        if (endStatus === google.maps.GeocoderStatus.OK) {
          const endLocation = endResults[0].geometry.location;
          console.log('End location:', endLocation.lat(), endLocation.lng());
          
          // Draw the route regardless of bounds check
          drawRoute(startAddress, endAddress, google.maps.TravelMode.DRIVING, true, '#2196F3');
        } else {
          console.log('Invalid end address:', endStatus);
          alert("Could not find the destination location. Please try again.");
        }
      });
    } else {
      console.log('Invalid start address:', startStatus);
      alert("Could not find the start location. Please try again.");
    }
  });
}

function isWithinNYC(lat, lng) {
  return true; // Always return true since we're appending "New York City" to addresses
}

//
// 3. Draw route, animate marker, and store route info
//
function drawRoute(start, end, travelMode, animate = true, color = '#e53935') {
  const directionsService = new google.maps.DirectionsService();
  const request = {
    origin: start,
    destination: end,
    travelMode: travelMode
  };
  
  directionsService.route(request, function (response, status) {
    if (status === google.maps.DirectionsStatus.OK) {
      const route = response.routes[0];
      // Save route details in a global variable for conversation context
      currentRouteInfo = {
        startAddress: start,
        endAddress: end,
        path: route.overview_path
      };

      // Draw the route polyline on the map
      const routePath = new google.maps.Polyline({
        path: route.overview_path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 1,
        strokeWeight: 4
      });
      routePath.setMap(map);

      // Markers for start and end of the route
      new google.maps.Marker({
        position: route.overview_path[0],
        map: map,
        title: 'Start'
      });
      new google.maps.Marker({
        position: route.overview_path[route.overview_path.length - 1],
        map: map,
        title: 'Destination'
      });

      if (animate) {
        // Ensure we have a valid path before starting animation
        if (route.overview_path && route.overview_path.length > 0) {
          console.log('Starting animation with path length:', route.overview_path.length);
          animateIcon(route.overview_path);
        } else {
          console.error('Invalid path for animation');
        }
      }

      // Update Street View to the first location on the route
      updateStreetView(route.overview_path[0]);
    } else {
      console.error("Failed to get directions:", status);
      alert("Failed to get directions. Please check the locations.");
    }
  });
}

function animateIcon(path) {
  if (animatedMarker) {
    animatedMarker.setMap(null);
  }
  animatedMarker = new google.maps.Marker({
    position: path[0],
    map: map,
    icon: {
      url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
      scaledSize: new google.maps.Size(30, 30)
    }
  });
  
  isAnimating = true;
  let index = 0;
  
  // Initialize Street View at the start position
  updateStreetView(path[0]);
  
  function move() {
    if (index < path.length) {
      // Update marker position
      const currentPosition = path[index];
      animatedMarker.setPosition(currentPosition);
      
      // Calculate heading for Street View
      let heading = 0;
      if (index < path.length - 1) {
        const current = path[index];
        const next = path[index + 1];
        heading = google.maps.geometry.spherical.computeHeading(current, next);
      }
      
      // Update Street View with smooth transition
      const panorama = streetView;
      panorama.setPosition(currentPosition);
      panorama.setPov({
        heading: heading,
        pitch: 0,
        zoom: 1
      });
      
      // Log the movement for debugging
      console.log(`Moving marker to position ${index}:`, currentPosition.lat(), currentPosition.lng());
      
      index++;
      // Use a shorter interval for smoother movement
      animationTimeout = setTimeout(move, 3000); // 1 second between points for smoother movement
    } else {
      isAnimating = false;
      // Only progress to next location after animation is complete
      if (isJourneyActive) {
        setTimeout(progressToNextLocation, 10000); // 5 second pause at destination
      }
    }
  }
  
  // Start the animation
  move();
  
  // Add cleanup function
  return () => {
    if (animationTimeout) {
      clearTimeout(animationTimeout);
    }
    isAnimating = false;
  };
}

function updateStreetView(location) {
  if (!streetView) return;
  if (freezeStreetView) return; // do not change panorama while frozen for conversation view
  
  // Get the current position
  const currentPosition = streetView.getPosition();
  
  // Calculate heading if we have a current position
  let heading = 0;
  if (currentPosition) {
    heading = google.maps.geometry.spherical.computeHeading(currentPosition, location);
  }
  
  // Update Street View with smooth transition
  streetView.setPosition(location);
  streetView.setPov({
    heading: heading,
    pitch: 0,
    zoom: 1
  });
}

//
// 4. Toggle Street View on/off
//
function toggleStreetView() {
  const mapDiv = document.getElementById("map");
  const streetViewDiv = document.getElementById("street-view");
  if (mapDiv.style.display === "none") {
    mapDiv.style.display = "block";
    streetViewDiv.style.display = "none";
    // hide return button when map is shown
    const returnBtn = document.getElementById('return-street-btn');
    if (returnBtn) returnBtn.style.display = 'none';
  } else {
    mapDiv.style.display = "none";
    streetViewDiv.style.display = "block";
    // show return button when street view is shown
    const returnBtn = document.getElementById('return-street-btn');
    if (returnBtn) returnBtn.style.display = 'block';
  }
}

// Return from Street View to Map (used by the return button)
function returnFromStreetView() {
  const mapDiv = document.getElementById("map");
  const streetViewDiv = document.getElementById("street-view");
  mapDiv.style.display = "block";
  if (streetViewDiv) streetViewDiv.style.display = "none";
  const returnBtn = document.getElementById('return-street-btn');
  if (returnBtn) returnBtn.style.display = 'none';
}

//
// 5. Conversation View logic and 3D scene for agents
//
let scene, camera, renderer;
let agent1, agent2;
let currentTalkingAgent = null; // Track which agent is currently talking

function init3DScene() {
  const container = document.getElementById("agent-3d-container");
  // Create Three.js scene
  scene = new THREE.Scene();

  // Set up camera
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 2, 5);

  // Set up renderer
  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  // Add ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  // Add directional light for better shadows
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);

  // Load Agent1 model
  const loader = new THREE.GLTFLoader();
  loader.load('models/agent1.glb', function(gltf) {
    agent1 = gltf.scene;
    agent1.position.set(-3, 0.5, 0);  // Moved 1 unit right (from -4 to -3)
    agent1.scale.set(0.625, 0.6875, 0.3125);  // Doubled X scale (0.3125 * 2), kept Y and Z the same
    agent1.rotation.set(0, 0.6, 0);  // Increased right rotation (positive Y rotation)
    scene.add(agent1);
    
    // Store the default rotation
    agent1.defaultRotation = agent1.rotation.y;
  }, undefined, function(error) {
    console.error('Error loading Agent1:', error);
  });

  // Load Agent2 model
  loader.load('models/agent2.glb', function(gltf) {
    agent2 = gltf.scene;
    agent2.position.set(3, 3.0, 0);  // Moved higher above the ground (from 1.0 to 1.5)
    agent2.scale.set(0.625, 0.6875, 0.3125);  // Matched with agent1's scale
    agent2.rotation.set(0, -0.6, 0);  // Increased left rotation (negative Y rotation)
    scene.add(agent2);
    
    // Store the default rotation
    agent2.defaultRotation = agent2.rotation.y;
  }, undefined, function(error) {
    console.error('Error loading Agent2:', error);
  });

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);
  function onWindowResize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  animateScene();
}

function animateScene() {
  requestAnimationFrame(animateScene);
  
  if (!isConversationPaused) {
    // Talking animation
    if (currentTalkingAgent === "Agent1" && agent1) {
      // Active talking animation for Agent1
      agent1.rotation.y = agent1.defaultRotation + Math.sin(Date.now() * 0.005) * 0.2;
      agent1.position.y = Math.sin(Date.now() * 0.003) * 0.15;
    } else if (agent1) {
      // Idle animation for Agent1
      agent1.rotation.y = agent1.defaultRotation + Math.sin(Date.now() * 0.001) * 0.05;
      agent1.position.y = Math.sin(Date.now() * 0.001) * 0.05;
    }

    if (currentTalkingAgent === "Agent2" && agent2) {
      // Active talking animation for Agent2
      agent2.rotation.y = agent2.defaultRotation + Math.sin(Date.now() * 0.005) * 0.2;
      agent2.position.y = Math.sin(Date.now() * 0.003) * 0.15;
    } else if (agent2) {
      // Idle animation for Agent2
      agent2.rotation.y = agent2.defaultRotation + Math.sin(Date.now() * 0.001) * 0.05;
      agent2.position.y = Math.sin(Date.now() * 0.001) * 0.05;
    }
  } else {
    // Still animation when paused
    if (agent1) {
      agent1.rotation.y = agent1.defaultRotation;
      agent1.position.y = 0;
    }
    if (agent2) {
      agent2.rotation.y = agent2.defaultRotation;
      agent2.position.y = 0;
    }
  }
  
  renderer.render(scene, camera);
}

function toggleConversationView() {
  // If turning ON the conversation view:
  if (!isConversationView) {
    // Initialize TTS when entering conversation view
    initTTS().then(() => {
      console.log("TTS initialized in conversation view");
    }).catch(error => {
      console.error("Error initializing TTS:", error);
    });
    // Hide the map and show the live Street View panorama behind the conversation UI,
    // but freeze it so it appears as a still background during the conversation.
    const mapDiv = document.getElementById("map");
    const streetViewDiv = document.getElementById("street-view");
    mapDiv.style.display = "none";
    if (streetViewDiv) {
      streetViewDiv.style.display = "block";
    }
    // Stop any automatic refresh nudges — we want the live panorama to remain visually frozen.
    if (streetViewRefreshInterval) {
      clearInterval(streetViewRefreshInterval);
      streetViewRefreshInterval = null;
    }
    // Freeze further updates to the panorama while conversation view is active
    freezeStreetView = true;
    // Ensure the panorama is visible
    if (streetView && typeof streetView.setVisible === 'function') {
      try { streetView.setVisible(true); } catch (e) { /* ignore */ }
    }
    const conversationDiv = document.getElementById("conversation-view");
    conversationDiv.style.display = "block";
    conversationDiv.style.background = 'transparent';

    // Initialize the 3D scene if not already initialized
    if (!scene) {
      init3DScene();
    }
    isConversationView = true;

    // Ensure animation continues
    if (isAnimating && animationTimeout) {
      console.log("Maintaining animation in conversation view");
    }
  } else {
    // Turning OFF conversation view
    document.getElementById("conversation-view").style.display = "none";
    document.getElementById("map").style.display = "block";
    // Hide the full-screen Street View when returning to map and clear the refresh interval
    const streetViewDiv = document.getElementById("street-view");
    if (streetViewDiv) streetViewDiv.style.display = "none";
    // Unfreeze Street View now that conversation view is closed
    freezeStreetView = false;
    if (streetViewRefreshInterval) {
      clearInterval(streetViewRefreshInterval);
      streetViewRefreshInterval = null;
    }
    isConversationView = false;
  }
}

/**
 * Constructs a Street View static image URL for the conversation background.
 */
function getStreetViewStaticUrl(lat, lng, heading = 235) {
  const base = "https://maps.googleapis.com/maps/api/streetview";
  // Use current window size to generate a full-bleed background image
  const w = Math.min(window.innerWidth || 1024, 2048);
  const h = Math.min(window.innerHeight || 768, 2048);
  const size = `size=${w}x${h}`;
  const location = `location=${lat},${lng}`;
  const fov = "fov=80";
  const pitch = "pitch=0";
  const head = `heading=${Math.round(heading)}`;
  const key = "key=AIzaSyDd_u8UAQ8eYfBMm3iYvjNOJpBeIMo_XvA"; // Replace with a valid API key
  return `${base}?${size}&${location}&${fov}&${pitch}&${head}&${key}`;
}

//
// 6. Gemini Chat / LLM Integration for manual input
//
function sendMessage() {
  const userInput = document.getElementById("chat-input").value.trim();
  if (!userInput) return;
  document.getElementById("chat-input").value = "";
  addToChatLog("User", userInput);
  callGemini([ { role: "user", content: userInput } ])
    .then(response => {
      addToChatLog("Agent", response);
    })
    .catch(err => {
      console.error("LLM Error (Gemini):", err);
      addToChatLog("Agent", "Sorry, something went wrong with Gemini...");
    });
}

function addToChatLog(sender, text) {
  const chatLog = document.getElementById("chat-log");
  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-message ${sender.toLowerCase()}`;
  
  const senderDiv = document.createElement("div");
  senderDiv.className = "chat-sender";
  senderDiv.textContent = sender;
  
  const bubbleDiv = document.createElement("div");
  bubbleDiv.className = `chat-bubble ${sender.toLowerCase()}`;
  
  // Format the text with line breaks for better readability
  const formattedText = text.replace(/\. /g, '.\n');
  bubbleDiv.innerHTML = formattedText;
  
  messageDiv.appendChild(senderDiv);
  messageDiv.appendChild(bubbleDiv);
  chatLog.appendChild(messageDiv);
  chatLog.scrollTop = chatLog.scrollHeight;
}

//
// 7. Automated Agent-to-Agent Conversation and Pause/Resume
//
function callGemini(messages) {
  const apiKey = "AIzaSyAKPLSO1olLhKCVXEfYtr2hvRqDEa87MfU";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey;

  // Format the conversation text
  const conversationText = messages.map(msg => {
    if (msg.role === "system") {
      return `Instructions: ${msg.content}`;
    }
    return `${msg.role}: ${msg.content}`;
  }).join('\n\n');

  const prompt = {
    contents: [{
      parts: [{
        text: conversationText
      }]
    }],
    generationConfig: {
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
      stopSequences: ["\n\n"]
    }
  };

  console.log('Sending request to Gemini:', JSON.stringify(prompt, null, 2));

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prompt),
  })
    .then(res => {
      console.log('Gemini response status:', res.status);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      console.log('Gemini response data:', JSON.stringify(data, null, 2));
      if (data.candidates && data.candidates.length > 0 &&
          data.candidates[0].content && data.candidates[0].content.parts &&
          data.candidates[0].content.parts.length > 0) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error("No valid response from Gemini API");
    });
}

// Modify the initTTS function
async function initTTS() {
  if (ttsInitPromise) return ttsInitPromise;
  
  ttsInitPromise = new Promise(async (resolve, reject) => {
    try {
      // Initialize audio context
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Load the Google Cloud TTS API
      await new Promise((resolve, reject) => {
        gapi.load('client', resolve);
      });
      
      // Initialize the client
      await gapi.client.init({
        apiKey: 'AIzaSyDd_u8UAQ8eYfBMm3iYvjNOJpBeIMo_XvA',
        discoveryDocs: ['https://texttospeech.googleapis.com/$discovery/rest?version=v1']
      });

      // Load the texttospeech API
      await gapi.client.load('texttospeech', 'v1');
      
      isTTSInitialized = true;
      console.log("TTS initialized successfully");
      resolve();
    } catch (error) {
      console.error("Error initializing TTS:", error);
      reject(error);
    }
  });
  
  return ttsInitPromise;
}

// Modify speakWithPromise to track TTS completion
async function speakWithPromise(text, agent) {
  if (!isTTSInitialized) {
    try {
      await initTTS();
    } catch (error) {
      console.error("Failed to initialize TTS:", error);
      return;
    }
  }

  isTTSComplete = false; // Mark TTS as not complete when starting

  return new Promise((resolve, reject) => {
    if (!audioContext) {
      console.error("Audio context not initialized");
      reject("Audio context not initialized");
      return;
    }

    // Set voice based on agent with correct language codes
    let voice;
    if (agent === "Agent1") {
      voice = {
        languageCode: 'en-US',
        name: 'en-US-Neural2-D',
        ssmlGender: 'MALE'
      };
    } else if (agent === "Agent2") {
      voice = {
        languageCode: 'en-GB',
        name: 'en-GB-Neural2-B',
        ssmlGender: 'MALE'
      };
    }
    
    // Configure audio settings
    const audioConfig = {
      audioEncoding: 'MP3',
      speakingRate: agent === "Agent1" ? 0.9 : 0.9,
      pitch: agent === "Agent1" ? 2.2 : 2.2
    };

    // Prepare the request body
    const requestBody = {
      input: { text: text },
      voice: voice,
      audioConfig: audioConfig
    };

    console.log("Sending TTS request:", requestBody);

    // Make the TTS request
    gapi.client.texttospeech.text.synthesize(requestBody)
      .then(response => {
        console.log("TTS API Response:", response);
        
        if (!response || !response.result || !response.result.audioContent) {
          console.error("Invalid TTS response:", response);
          reject("Invalid response from TTS API");
          return;
        }

        // Convert base64 to audio
        const audioData = response.result.audioContent;
        const audioBlob = new Blob([Uint8Array.from(atob(audioData), c => c.charCodeAt(0))], { type: 'audio/mp3' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio
        const audio = new Audio();
        audio.src = audioUrl;
        currentTalkingAgent = agent;

        // Ensure audio context is running
        if (audioContext.state === 'suspended') {
          audioContext.resume();
        }

        // Create a promise to track audio completion
        const audioPromise = new Promise((resolveAudio, rejectAudio) => {
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentTalkingAgent = null;
            isTTSComplete = true;
            console.log(`${agent} finished speaking`);
            // Check if we need to continue conversation
            setTimeout(checkAndContinueConversation, 1000); // Wait 1 second before continuing
            resolveAudio();
          };

          audio.onerror = (error) => {
            console.error("Error playing audio:", error);
            isTTSComplete = true;
            rejectAudio(error);
          };
        });

        // Play the audio and wait for completion
        audio.play().then(() => {
          console.log(`${agent} started speaking`);
        }).catch(playError => {
          console.error("Error playing audio:", playError);
          isTTSComplete = true;
          reject(playError);
        });

        // Wait for audio to complete before resolving
        audioPromise.then(() => {
          resolve();
        }).catch(error => {
          reject(error);
        });
      })
      .catch(error => {
        console.error("Error in speech synthesis:", error);
        isTTSComplete = true;
        if (error.result) {
          console.error("API Error details:", error.result);
        }
        reject(error);
      });
  });
}

// Function to load CoT data
async function loadCotData() {
  try {
    const response = await fetch('CoT(main).csv');
    const csvText = await response.text();
    cotData = csvText.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          // Remove BOM, trim whitespace
          const cleanLine = line.trim().replace(/^\uFEFF/, '');
          if (!cleanLine) return null;
          // Parse the JSON object
          const parsed = JSON.parse(cleanLine);
          return {
            CoT: parsed.CoT,
            next_place: parsed.next_place,
            response_to_other_agent: parsed.response_to_other_agent
          };
        } catch (e) {
          console.error('Error parsing CoT line:', e, 'Line:', line);
          return null;
        }
      })
      .filter(item => item !== null);
    
    console.log('Loaded CoT data:', cotData); // Debug log
  } catch (error) {
    console.error('Error loading CoT data:', error);
  }
}

// Modify progressToNextLocation to check TTS completion
function progressToNextLocation() {
  if (!isJourneyActive || currentLocationIndex + 1 >= currentRoute.length) {
    isJourneyActive = false;
    console.log('Journey completed');
    updateJourneyDisplay();
    addToChatLog("System", "Journey completed!");
    return;
  }

  const start = currentRoute[currentLocationIndex];
  const end = currentRoute[currentLocationIndex + 1];
  currentLocationIndex++;
  
  // Update the route display
  checkLocationInNYC(start, end);
  
  // Update journey progress display
  updateJourneyDisplay();
  
  // Only generate new conversation if we've moved to a new location
  if (lastProcessedLocation !== end) {
    lastProcessedLocation = end;
    // Add progress to conversation
    addToChatLog("System", `Progressing to next segment: ${start} → ${end}`);
    
    // If conversation is active and TTS is complete, continue with next agent
    if (isConversationView && !isConversationPaused) {
      if (isTTSComplete) {
        simulateAgentConversation(nextAgentToSpeak);
      } else {
        // Mark that we need to continue conversation after TTS completes
        pendingConversation = true;
      }
    }
  }
}

// Helper to get current journey progress as a string
function getCurrentJourneyProgressText() {
  if (!isJourneyActive || !currentRoute || currentRoute.length === 0) return '';
  let currentSegment = '';
  if (currentLocationIndex < currentRoute.length - 1) {
    const currentStart = currentRoute[currentLocationIndex];
    const currentEnd = currentRoute[currentLocationIndex + 1];
    currentSegment = `${currentStart} → ${currentEnd}`;
  } else {
    currentSegment = 'Journey Complete';
  }
  let upcoming = [];
  for (let i = currentLocationIndex + 1; i < currentRoute.length - 1; i++) {
    upcoming.push(`${currentRoute[i]} → ${currentRoute[i + 1]}`);
  }
  let upcomingText = upcoming.length > 0 ? upcoming.join(', ') : 'No more upcoming locations.';
  return `Current Segment: ${currentSegment}\nUpcoming Locations: ${upcomingText}`;
}

// Modify simulateAgentConversation to alternate agents after each response
async function simulateAgentConversation(currentAgent) {
  if (isConversationPaused) {
    return;
  }

  // If TTS is not complete, mark that we need to continue conversation
  if (!isTTSComplete) {
    pendingConversation = true;
    return;
  }

  // Reset pending conversation flag
  pendingConversation = false;
  
  try {
    // Ensure TTS is initialized
    if (!isTTSInitialized) {
      await initTTS();
    }

    // Set the current talking agent
    currentTalkingAgent = currentAgent;
    
    // Check if we have journey details
    if (!currentJourneyDetails) {
      // Generate initial waiting message
      try {
        const waitingMessages = [
          {
            role: "system",
            content: `You are ${currentAgent}, a helpful assistant providing journey updates in New York City.\nCurrent Situation:\n- Waiting for user to select journey details\n- No origin or destination has been selected yet\n\nJourney Progress:\n${getCurrentJourneyProgressText()}\n\nProvide a brief, friendly message asking the user to select their journey details.\nKeep it concise and informative.\nDo not mention any specific locations since none have been selected yet.\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses. Each message must be unique and not similar to earlier ones. Reference the conversation history and avoid redundancy.`
          },
          {
            role: "user",
            content: "What should I do to start my journey?"
          }
        ];
        
        const waitingResponse = await callGemini(waitingMessages);
        addToChatLog(currentAgent, waitingResponse);
        
        // Wait for TTS to complete before proceeding
        await speakWithPromise(waitingResponse, currentAgent);
        console.log("First response completed speaking");
        
        // Add a pause after speaking
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Error getting waiting response:", err);
        const fallbackMessage = `${currentAgent} is waiting for you to select your journey details. Please choose your start location and destination to begin.`;
        addToChatLog(currentAgent, fallbackMessage);
        await speakWithPromise(fallbackMessage, currentAgent);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return;
    }

    // If we have journey details, proceed with normal conversation
    const startLocation = currentJourneyDetails.start;
    const endLocation = currentJourneyDetails.end;
    const completeRoute = currentJourneyDetails.route;
    const intermediateLocations = currentJourneyDetails.intermediateLocations;
    const currentLocation = lastProcessedLocation || startLocation;
    
    // Find matching CoT entry
    const matchingCot = cotData.find((cot, index) => {
      const cotText = cot.CoT.toLowerCase();
      return cotText.includes(startLocation.toLowerCase()) && 
             cotText.includes(endLocation.toLowerCase());
    });

    const journeyProgressText = getCurrentJourneyProgressText();

    if (matchingCot) {
      if (currentAgent === "Agent1") {
        // Generate Gemini response for Agent1
        try {
          const messages = [
            {
              role: "system",
              content: `You are Agent1, a witty and friendly urban navigation expert in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n- Next planned stop: ${matchingCot.next_place}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nYour Chain of Thought (CoT):\n${matchingCot.CoT}\n\nPrevious Agent Response:\n${matchingCot.response_to_other_agent}\n\nYour Response Should:\n1. Acknowledge the current location and next planned stop\n2. Use your CoT reasoning to explain your route choice\n3. Explain why you chose this specific route based on your CoT\n4. Mention any interesting landmarks or points of interest along the way\n5. Show enthusiasm about the journey\n6. Maintain a friendly, conversational tone\n7. Reference specific intermediate locations in your response\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses, including your own or the other agent's. Each message must be unique, fresh, and not similar to earlier ones. Reference the conversation history and avoid redundancy.\n\nImportant: Your response must directly reference and build upon your CoT reasoning above.\nBe specific about locations and transportation choices mentioned in your CoT.\nMake your response natural and engaging, as if you're having a real conversation.\nAvoid repeating previous responses - provide new insights and perspectives.\nConsider the previous agent's response in your analysis.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.`
            },
            ...conversationHistory,
            {
              role: "user",
              content: "Based on your Chain of Thought reasoning and the previous agent's response, what are your thoughts about this journey segment and why did you choose this route?"
            }
          ];
          
          const geminiResponse = await callGemini(messages);
          conversationHistory.push({ role: "assistant", content: geminiResponse });
          addToChatLog("Agent1", geminiResponse);
          // Wait for TTS to complete before proceeding
          await speakWithPromise(geminiResponse, "Agent1");
          // Add a pause after speaking
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.error("Error getting Gemini response:", err);
        }
      } else {
        // Generate Gemini response for Agent2
        try {
          const messages = [
            {
              role: "system",
              content: `You are Agent2, a serious and analytical urban transportation expert in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n- Next planned stop: ${matchingCot.next_place}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nChain of Thought (CoT) Analysis:\n${matchingCot.CoT}\n\nYour Previous Response:\n${matchingCot.response_to_other_agent}\n\nYour Response Should:\n1. Acknowledge the current location and next planned stop\n2. Evaluate the current route choice based on the CoT reasoning\n3. Consider potential challenges or delays mentioned in the CoT\n4. Suggest any optimizations if needed\n5. Analyze the efficiency of the chosen route\n6. Maintain a professional, analytical tone\n7. Reference specific intermediate locations in your analysis\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses, including your own or the other agent's. Each message must be unique, fresh, and not similar to earlier ones. Reference the conversation history and avoid redundancy.\n\nImportant: Your response must directly reference and build upon the CoT reasoning and your previous response.\nBe specific about subway lines, bus routes, or other transportation options mentioned.\nMake your response detailed and informative, while maintaining a natural conversation flow.\nAvoid repeating previous responses - provide new insights and perspectives.\nConsider the CoT analysis in your evaluation.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.`
            },
            ...conversationHistory,
            {
              role: "user",
              content: "Based on the Chain of Thought reasoning and your previous response, what's your analysis of this journey segment and what transportation options would you consider?"
            }
          ];
          
          const geminiResponse = await callGemini(messages);
          conversationHistory.push({ role: "assistant", content: geminiResponse });
          addToChatLog("Agent2", geminiResponse);
          // Wait for TTS to complete before proceeding
          await speakWithPromise(geminiResponse, "Agent2");
          // Add a pause after speaking
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.error("Error getting Gemini response:", err);
        }
      }
    } else {
      // Generate fallback message using Gemini
      try {
        const fallbackMessages = [
          {
            role: "system",
            content: `You are ${currentAgent}, a helpful assistant providing journey updates in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nAvailable CoT Data:\n${JSON.stringify(cotData, null, 2)}\n\nProvide a brief message indicating that the journey is being analyzed.\nUse the available CoT data to provide context about possible routes.\nKeep it concise and informative.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses. Each message must be unique and not similar to earlier ones. Reference the conversation history and avoid redundancy.`
          },
          {
            role: "user",
            content: "What's the current status of our journey and what possible routes are being considered?"
          }
        ];
        
        const fallbackResponse = await callGemini(fallbackMessages);
        addToChatLog(currentAgent, fallbackResponse);
        // Wait for TTS to complete before proceeding
        await speakWithPromise(fallbackResponse, currentAgent);
        // Add a pause after speaking
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Error getting fallback response:", err);
        const fallbackMessage = `${currentAgent} is analyzing the journey from ${currentLocation} to the next stop.`;
        addToChatLog(currentAgent, fallbackMessage);
        await speakWithPromise(fallbackMessage, currentAgent);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Wait a longer pause between agents
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alternate agent for next turn
    nextAgentToSpeak = currentAgent === "Agent1" ? "Agent2" : "Agent1";
    if (!isConversationPaused) {
      simulateAgentConversation(nextAgentToSpeak);
    }
  } catch (err) {
    console.error("Error in conversation:", err);
    addToChatLog("System", `Error: ${err.message}`);
    currentTalkingAgent = null;
    isTTSComplete = true; // Ensure TTS is marked as complete on error
  }
}

// Add a function to check and continue conversation if needed
function checkAndContinueConversation() {
  if (pendingConversation && isTTSComplete && !isConversationPaused) {
    const currentAgent = currentTalkingAgent || "Agent1";
    simulateAgentConversation(currentAgent);
  }
}

// Modify startAgentInteraction to reset conversation history
function startAgentInteraction() {
  // Clear previous chat log
  const chatLog = document.getElementById("chat-log");
  if (chatLog) {
    chatLog.innerHTML = '';
  }

  // Reset conversation state
  conversationHistory = [];
  isConversationPaused = false;
  currentTalkingAgent = null;

  // Set current journey details
  if (currentRouteInfo) {
    currentJourneyDetails = {
      start: currentRouteInfo.startAddress.split(',')[0].trim(),
      end: currentRouteInfo.endAddress.split(',')[0].trim(),
      route: currentRoute,
      intermediateLocations: currentRoute.slice(1, -1) // All locations between start and end
    };
  }
  
  // Add initial system message with journey details
  if (currentJourneyDetails) {
    const initialMessage = `Starting new journey from ${currentJourneyDetails.start} to ${currentJourneyDetails.end}.`;
    addToChatLog("System", initialMessage);
    
    // Add journey details to conversation history
    conversationHistory.push({
      role: "system",
      content: `Current Journey Details:
      - Starting from: ${currentJourneyDetails.start}
      - Final Destination: ${currentJourneyDetails.end}
      - Complete Route: ${currentJourneyDetails.route.join(' → ')}`
    });
  } else {
    addToChatLog("System", "Waiting for journey details to begin...");
  }

  // Start with Agent1
  simulateAgentConversation("Agent1");
}

function pauseAgentInteraction() {
  isConversationPaused = true;
  currentTalkingAgent = null;
  if (conversationTimeout) {
    clearTimeout(conversationTimeout);
  }
  // Stop any ongoing speech
  if (audioContext) {
    audioContext.suspend();
    audioQueue = [];
    isProcessingQueue = false;
  }
  document.getElementById("pause-interaction").style.display = "none";
  document.getElementById("resume-interaction").style.display = "inline-block";
  addToChatLog("System", "Agent interaction paused.");
}

function resumeAgentInteraction() {
  isConversationPaused = false;
  document.getElementById("resume-interaction").style.display = "none";
  document.getElementById("pause-interaction").style.display = "inline-block";
  addToChatLog("System", "Agent interaction resumed.");
  
  if (audioContext) {
    audioContext.resume();
  }
  
  let lastMsg = conversationHistory[conversationHistory.length - 1];
  let lastAgent = (lastMsg && lastMsg.content && lastMsg.content.includes("Agent1")) ? "Agent1" : "Agent2";
  const nextAgent = lastAgent === "Agent1" ? "Agent2" : "Agent1";
  simulateAgentConversation(nextAgent);
}

function returnToMap() {
  document.getElementById("conversation-view").style.display = "none";
  document.getElementById("map").style.display = "block";
  isConversationView = false;
  
  // Stop any ongoing speech
  if (audioContext) {
    audioContext.suspend();
    audioQueue = [];
    isProcessingQueue = false;
  }
  
  // Don't cleanup animation when returning to map
  // Just ensure the map is visible
  
  // Pause the conversation if it's running
  if (!isConversationPaused) {
    pauseAgentInteraction();
  }
  // Ensure Street View refresh interval is cleared when returning to the map
  if (streetViewRefreshInterval) {
    clearInterval(streetViewRefreshInterval);
    streetViewRefreshInterval = null;
  }
  // Hide the Street View element when returning to the map
  const streetViewDiv = document.getElementById('street-view');
  if (streetViewDiv) streetViewDiv.style.display = 'none';
  // Unfreeze Street View now that conversation view is closed
  freezeStreetView = false;
}

// Function to load and parse CSV data
async function loadRouteData() {
  try {
    const response = await fetch('blue_agent_paths_unique.csv');
    const csvText = await response.text();
    routeData = csvText.split('\n')
      .filter(line => line.trim())
      .map(line => line.split(',').map(item => item.trim()).filter(item => item));
    
    // Populate dropdowns with unique locations
    const uniqueLocations = [...new Set(routeData.flat())];
    const startSelect = document.getElementById('start');
    const finalDestinationSelect = document.getElementById('final-destination');
    
    uniqueLocations.forEach(location => {
      if (location) {
        startSelect.add(new Option(location, location));
        finalDestinationSelect.add(new Option(location, location));
      }
    });
  } catch (error) {
    console.error('Error loading route data:', error);
  }
}

// Function to find the route between start and final destination
function findRoute(startLocation, finalDestination) {
  // Find the row that contains both start and final destination
  const route = routeData.find(row => {
    const startIndex = row.indexOf(startLocation);
    const endIndex = row.indexOf(finalDestination);
    return startIndex !== -1 && endIndex !== -1 && startIndex < endIndex;
  });

  if (route) {
    // Get the sub-array from start to final destination
    const startIndex = route.indexOf(startLocation);
    const endIndex = route.indexOf(finalDestination);
    currentRoute = route.slice(startIndex, endIndex + 1);
    currentLocationIndex = 0;
    
    // Update currentJourneyDetails with the complete route including intermediate locations
    currentJourneyDetails = {
      start: startLocation,
      end: finalDestination,
      route: currentRoute,
      intermediateLocations: currentRoute.slice(1, -1) // All locations between start and end
    };
    
    return true;
  }
  return false;
}

// Function to update journey progress display
function updateJourneyDisplay() {
  const journeyProgress = document.getElementById('journey-progress');
  const currentSegment = document.getElementById('current-segment');
  const locationsList = document.getElementById('locations-list');
  
  if (!isJourneyActive || currentRoute.length === 0) {
    journeyProgress.style.display = 'none';
    return;
  }

  // Show the journey progress panel
  journeyProgress.style.display = 'block';

  // Update current segment
  if (currentLocationIndex < currentRoute.length - 1) {
    const currentStart = currentRoute[currentLocationIndex];
    const currentEnd = currentRoute[currentLocationIndex + 1];
    currentSegment.textContent = `${currentStart} → ${currentEnd}`;
  } else {
    currentSegment.textContent = 'Journey Complete';
  }

  // Update upcoming locations
  locationsList.innerHTML = '';
  for (let i = currentLocationIndex + 1; i < currentRoute.length - 1; i++) {
    const li = document.createElement('li');
    li.textContent = `${currentRoute[i]} → ${currentRoute[i + 1]}`;
    locationsList.appendChild(li);
  }
}

// Add a function to update journey progress in the conversation view
function updateConversationJourneyProgress() {
  const chatContainer = document.getElementById('chat-container');
  if (!chatContainer) return;

  // Remove any existing journey progress element
  let journeyDiv = document.getElementById('conversation-journey-progress');
  if (journeyDiv) {
    journeyDiv.remove();
  }

  // Only show if journey is active and route is set
  if (!isJourneyActive || !currentRoute || currentRoute.length === 0) return;

  journeyDiv = document.createElement('div');
  journeyDiv.id = 'conversation-journey-progress';
  journeyDiv.style.background = 'rgba(255,255,255,0.85)';
  journeyDiv.style.borderRadius = '8px';
  journeyDiv.style.padding = '10px 16px';
  journeyDiv.style.marginBottom = '12px';
  journeyDiv.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
  journeyDiv.style.color = '#222';

  // Current segment
  let currentSegment = '';
  if (currentLocationIndex < currentRoute.length - 1) {
    const currentStart = currentRoute[currentLocationIndex];
    const currentEnd = currentRoute[currentLocationIndex + 1];
    currentSegment = `${currentStart} → ${currentEnd}`;
  } else {
    currentSegment = 'Journey Complete';
  }

  // Upcoming locations
  let upcomingHtml = '';
  if (currentLocationIndex + 1 < currentRoute.length - 1) {
    upcomingHtml = '<ul style="margin: 5px 0; padding-left: 20px;">';
    for (let i = currentLocationIndex + 1; i < currentRoute.length - 1; i++) {
      upcomingHtml += `<li>${currentRoute[i]} → ${currentRoute[i + 1]}</li>`;
    }
    upcomingHtml += '</ul>';
  } else {
    upcomingHtml = '<span>No more upcoming locations.</span>';
  }

  journeyDiv.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 4px;">Journey Progress</div>
    <div><strong>Current Segment:</strong> <span>${currentSegment}</span></div>
    <div style="margin-top: 4px;"><strong>Upcoming Locations:</strong> ${upcomingHtml}</div>
  `;

  // Insert at the top of chat container
  chatContainer.insertBefore(journeyDiv, chatContainer.firstChild);
}

// Patch: call updateConversationJourneyProgress whenever journey progress updates
// Add to updateJourneyDisplay and progressToNextLocation
const _originalUpdateJourneyDisplay = updateJourneyDisplay;
updateJourneyDisplay = function() {
  _originalUpdateJourneyDisplay.apply(this, arguments);
  updateConversationJourneyProgress();
};

// Modify progressToNextLocation to always start with Agent1 after each segment
const _originalProgressToNextLocation = progressToNextLocation;
progressToNextLocation = function() {
  _originalProgressToNextLocation.apply(this, arguments);
  updateConversationJourneyProgress();
  nextAgentToSpeak = "Agent1";
};

// Modify simulateAgentConversation to alternate agents after each response
async function simulateAgentConversation(currentAgent) {
  if (isConversationPaused) {
    return;
  }

  // If TTS is not complete, mark that we need to continue conversation
  if (!isTTSComplete) {
    pendingConversation = true;
    return;
  }

  // Reset pending conversation flag
  pendingConversation = false;
  
  try {
    // Ensure TTS is initialized
    if (!isTTSInitialized) {
      await initTTS();
    }

    // Set the current talking agent
    currentTalkingAgent = currentAgent;
    
    // Check if we have journey details
    if (!currentJourneyDetails) {
      // Generate initial waiting message
      try {
        const waitingMessages = [
          {
            role: "system",
            content: `You are ${currentAgent}, a helpful assistant providing journey updates in New York City.\nCurrent Situation:\n- Waiting for user to select journey details\n- No origin or destination has been selected yet\n\nJourney Progress:\n${getCurrentJourneyProgressText()}\n\nProvide a brief, friendly message asking the user to select their journey details.\nKeep it concise and informative.\nDo not mention any specific locations since none have been selected yet.\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses. Each message must be unique and not similar to earlier ones. Reference the conversation history and avoid redundancy.`
          },
          {
            role: "user",
            content: "What should I do to start my journey?"
          }
        ];
        
        const waitingResponse = await callGemini(waitingMessages);
        addToChatLog(currentAgent, waitingResponse);
        
        // Wait for TTS to complete before proceeding
        await speakWithPromise(waitingResponse, currentAgent);
        console.log("First response completed speaking");
        
        // Add a pause after speaking
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Error getting waiting response:", err);
        const fallbackMessage = `${currentAgent} is waiting for you to select your journey details. Please choose your start location and destination to begin.`;
        addToChatLog(currentAgent, fallbackMessage);
        await speakWithPromise(fallbackMessage, currentAgent);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return;
    }

    // If we have journey details, proceed with normal conversation
    const startLocation = currentJourneyDetails.start;
    const endLocation = currentJourneyDetails.end;
    const completeRoute = currentJourneyDetails.route;
    const intermediateLocations = currentJourneyDetails.intermediateLocations;
    const currentLocation = lastProcessedLocation || startLocation;
    
    // Find matching CoT entry
    const matchingCot = cotData.find((cot, index) => {
      const cotText = cot.CoT.toLowerCase();
      return cotText.includes(startLocation.toLowerCase()) && 
             cotText.includes(endLocation.toLowerCase());
    });

    const journeyProgressText = getCurrentJourneyProgressText();

    if (matchingCot) {
      if (currentAgent === "Agent1") {
        // Generate Gemini response for Agent1
        try {
          const messages = [
            {
              role: "system",
              content: `You are Agent1, a witty and friendly urban navigation expert in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n- Next planned stop: ${matchingCot.next_place}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nYour Chain of Thought (CoT):\n${matchingCot.CoT}\n\nPrevious Agent Response:\n${matchingCot.response_to_other_agent}\n\nYour Response Should:\n1. Acknowledge the current location and next planned stop\n2. Use your CoT reasoning to explain your route choice\n3. Explain why you chose this specific route based on your CoT\n4. Mention any interesting landmarks or points of interest along the way\n5. Show enthusiasm about the journey\n6. Maintain a friendly, conversational tone\n7. Reference specific intermediate locations in your response\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses, including your own or the other agent's. Each message must be unique, fresh, and not similar to earlier ones. Reference the conversation history and avoid redundancy.\n\nImportant: Your response must directly reference and build upon your CoT reasoning above.\nBe specific about locations and transportation choices mentioned in your CoT.\nMake your response natural and engaging, as if you're having a real conversation.\nAvoid repeating previous responses - provide new insights and perspectives.\nConsider the previous agent's response in your analysis.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.`
            },
            ...conversationHistory,
            {
              role: "user",
              content: "Based on your Chain of Thought reasoning and the previous agent's response, what are your thoughts about this journey segment and why did you choose this route?"
            }
          ];
          
          const geminiResponse = await callGemini(messages);
          conversationHistory.push({ role: "assistant", content: geminiResponse });
          addToChatLog("Agent1", geminiResponse);
          // Wait for TTS to complete before proceeding
          await speakWithPromise(geminiResponse, "Agent1");
          // Add a pause after speaking
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.error("Error getting Gemini response:", err);
        }
      } else {
        // Generate Gemini response for Agent2
        try {
          const messages = [
            {
              role: "system",
              content: `You are Agent2, a serious and analytical urban transportation expert in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n- Next planned stop: ${matchingCot.next_place}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nChain of Thought (CoT) Analysis:\n${matchingCot.CoT}\n\nYour Previous Response:\n${matchingCot.response_to_other_agent}\n\nYour Response Should:\n1. Acknowledge the current location and next planned stop\n2. Evaluate the current route choice based on the CoT reasoning\n3. Consider potential challenges or delays mentioned in the CoT\n4. Suggest any optimizations if needed\n5. Analyze the efficiency of the chosen route\n6. Maintain a professional, analytical tone\n7. Reference specific intermediate locations in your analysis\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses, including your own or the other agent's. Each message must be unique, fresh, and not similar to earlier ones. Reference the conversation history and avoid redundancy.\n\nImportant: Your response must directly reference and build upon the CoT reasoning and your previous response.\nBe specific about subway lines, bus routes, or other transportation options mentioned.\nMake your response detailed and informative, while maintaining a natural conversation flow.\nAvoid repeating previous responses - provide new insights and perspectives.\nConsider the CoT analysis in your evaluation.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.`
            },
            ...conversationHistory,
            {
              role: "user",
              content: "Based on the Chain of Thought reasoning and your previous response, what's your analysis of this journey segment and what transportation options would you consider?"
            }
          ];
          
          const geminiResponse = await callGemini(messages);
          conversationHistory.push({ role: "assistant", content: geminiResponse });
          addToChatLog("Agent2", geminiResponse);
          // Wait for TTS to complete before proceeding
          await speakWithPromise(geminiResponse, "Agent2");
          // Add a pause after speaking
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
          console.error("Error getting Gemini response:", err);
        }
      }
    } else {
      // Generate fallback message using Gemini
      try {
        const fallbackMessages = [
          {
            role: "system",
            content: `You are ${currentAgent}, a helpful assistant providing journey updates in New York City.\nUser's Selected Journey:\n- Origin: ${startLocation}\n- Destination: ${endLocation}\n- Current Location: ${currentLocation}\n- Complete Route: ${completeRoute.join(' → ')}\n- Intermediate Locations: ${intermediateLocations.join(', ')}\n\nCurrent Journey Progress:\n${journeyProgressText}\n\nAvailable CoT Data:\n${JSON.stringify(cotData, null, 2)}\n\nProvide a brief message indicating that the journey is being analyzed.\nUse the available CoT data to provide context about possible routes.\nKeep it concise and informative.\nReference the complete route and intermediate locations in your response.\nFocus on the current location and next planned stop.\nAlso, reference the current journey progress in your response.\n\nIMPORTANT: Do NOT repeat or rephrase any previous responses. Each message must be unique and not similar to earlier ones. Reference the conversation history and avoid redundancy.`
          },
          {
            role: "user",
            content: "What's the current status of our journey and what possible routes are being considered?"
          }
        ];
        
        const fallbackResponse = await callGemini(fallbackMessages);
        addToChatLog(currentAgent, fallbackResponse);
        // Wait for TTS to complete before proceeding
        await speakWithPromise(fallbackResponse, currentAgent);
        // Add a pause after speaking
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Error getting fallback response:", err);
        const fallbackMessage = `${currentAgent} is analyzing the journey from ${currentLocation} to the next stop.`;
        addToChatLog(currentAgent, fallbackMessage);
        await speakWithPromise(fallbackMessage, currentAgent);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Wait a longer pause between agents
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Alternate agent for next turn
    nextAgentToSpeak = currentAgent === "Agent1" ? "Agent2" : "Agent1";
    if (!isConversationPaused) {
      simulateAgentConversation(nextAgentToSpeak);
    }
  } catch (err) {
    console.error("Error in conversation:", err);
    addToChatLog("System", `Error: ${err.message}`);
    currentTalkingAgent = null;
    isTTSComplete = true; // Ensure TTS is marked as complete on error
  }
}

// Add a function to check and continue conversation if needed
function checkAndContinueConversation() {
  if (pendingConversation && isTTSComplete && !isConversationPaused) {
    const currentAgent = currentTalkingAgent || "Agent1";
    simulateAgentConversation(currentAgent);
  }
}

// Modify cleanupAnimation to be more selective
function cleanupAnimation() {
  // Only cleanup if we're actually stopping the journey
  if (!isJourneyActive) {
    if (animationTimeout) {
      clearTimeout(animationTimeout);
    }
    if (animatedMarker) {
      animatedMarker.setMap(null);
    }
    isAnimating = false;
  }
}