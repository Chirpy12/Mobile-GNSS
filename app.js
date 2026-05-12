// Global State
let points = [];
let map, currentPosMarker, polygonLayer;
let pointMarkers = [];
let currentPosition = null;
let isCountingDown = false;

// Initialize Map
function initMap() {
    map = L.map('map').setView([14.6539, 121.0685], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);
}

// Start GPS Tracking
function startTracking() {
    if (!navigator.geolocation) {
        alert("Geolocation not supported");
        return;
    }

    navigator.geolocation.watchPosition(
        (pos) => {
            currentPosition = pos;
            const { latitude, longitude, accuracy } = pos.coords;

            // Update UI (No colors, just pure data)
            document.getElementById('live-accuracy').textContent = `± ${accuracy.toFixed(1)} m`;
            document.getElementById('live-coords').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            document.getElementById('status-indicator').classList.add('active');
            
            if (!isCountingDown) {
                document.getElementById('btn-record').disabled = false;
            }

            // Update user dot (Black & Minimal)
            if (!currentPosMarker) {
                currentPosMarker = L.circleMarker([latitude, longitude], {
                    radius: 6, fillColor: "#000", color: "#fff", weight: 2, opacity: 1, fillOpacity: 1
                }).addTo(map);
                map.setView([latitude, longitude], 18);
            } else {
                currentPosMarker.setLatLng([latitude, longitude]);
            }
        },
        (err) => console.error(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
}

// Record Point with 15-second delay
document.getElementById('btn-record').addEventListener('click', () => {
    if (!currentPosition || isCountingDown) return;

    isCountingDown = true;
    const btnRecord = document.getElementById('btn-record');
    let timeLeft = 15;

    btnRecord.classList.add('btn-counting');
    btnRecord.innerHTML = `WAIT: ${timeLeft}s`;
    
    const countdownInterval = setInterval(() => {
        timeLeft--;
        
        if (timeLeft > 0) {
            btnRecord.innerHTML = `WAIT: ${timeLeft}s`;
        } else {
            clearInterval(countdownInterval);

            // Record the point
            const pt = {
                id: points.length + 1,
                lat: currentPosition.coords.latitude,
                lon: currentPosition.coords.longitude,
                acc: currentPosition.coords.accuracy,
                time: new Date().toLocaleTimeString()
            };

            points.push(pt);
            updateUI();

            // Reset Button
            btnRecord.classList.remove('btn-counting');
            btnRecord.innerHTML = `RECORD POINT`;
            isCountingDown = false;
            
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]); 
        }
    }, 1000);
});

// Update UI and Map Drawing
function updateUI() {
    const list = document.getElementById('point-list');
    document.getElementById('point-count').textContent = points.length;
    list.innerHTML = '';

    if (points.length === 0) {
        list.innerHTML = '<li class="empty-state">NO POINTS</li>';
    }

    // Clear old markers
    pointMarkers.forEach(m => map.removeLayer(m));
    pointMarkers = [];

    points.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span>PT ${p.id} [±${p.acc.toFixed(1)}m]</span> <span>${p.time}</span>`;
        list.appendChild(li);

        // Minimalist Map Markers (Default leaflet marker replaced with black circle)
        const m = L.circleMarker([p.lat, p.lon], {
            radius: 5, fillColor: "#fff", color: "#000", weight: 2, fillOpacity: 1
        }).addTo(map);
        pointMarkers.push(m);
    });

    calculateArea();
}

// Turf.js Area Calculation
function calculateArea() {
    if (points.length < 3) {
        document.getElementById('area-display').textContent = "0.00 m²";
        if (polygonLayer) map.removeLayer(polygonLayer);
        return;
    }

    const latlngs = points.map(p => [p.lat, p.lon]);
    
    // Draw Monochome Polygon
    if (polygonLayer) polygonLayer.setLatLngs(latlngs);
    else {
        polygonLayer = L.polygon(latlngs, { 
            color: '#000', 
            weight: 2, 
            fillColor: '#000',
            fillOpacity: 0.1 
        }).addTo(map);
    }
    map.fitBounds(polygonLayer.getBounds(), { padding: [20, 20] });

    const turfCoords = points.map(p => [p.lon, p.lat]);
    turfCoords.push(turfCoords[0]);
    const poly = turf.polygon([turfCoords]);
    const area = turf.area(poly);

    document.getElementById('area-display').textContent = `${area.toFixed(2)} m²`;
}

// Export CSV
document.getElementById('btn-export').addEventListener('click', () => {
    if (points.length === 0) return alert("No data");
    let csv = "PointID,Lat,Lon,Accuracy_m,Time\n";
    points.forEach(p => csv += `${p.id},${p.lat},${p.lon},${p.acc},${p.time}\n`);
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `gnss_data.csv`);
    a.click();
});

// Clear Data
document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("CLEAR ALL DATA?")) {
        points = [];
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        updateUI();
    }
});

// Initialize
window.onload = () => {
    initMap();
    startTracking();
};
