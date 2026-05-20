// Global State
let points = [];
let map, currentPosMarker, polygonLayer;
let pointMarkers = [];
let currentPosition = null;
let isCountingDown = false;
let referencePoint = null; // For local XYZ calculations

// Initialize Map
function initMap() {
    map = L.map('map').setView([14.6539, 121.0685], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);
}

// Convert Lat/Lon to UTM
function latLonToUTM(lat, lon) {
    const k0 = 0.9996;
    const a = 6378137.0; // WGS84 major axis
    const e = 0.0818192; // WGS84 eccentricity
    const e2 = e * e / (1 - e * e);
    
    const zoneNumber = Math.floor((lon + 180) / 6) + 1;
    const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3; // Central meridian
    
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const lonOriginRad = lonOrigin * Math.PI / 180;
    
    const n = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
    const t = Math.tan(latRad) * Math.tan(latRad);
    const c = e2 * Math.cos(latRad) * Math.cos(latRad);
    const a2 = Math.cos(latRad) * (lonRad - lonOriginRad);
    
    const m = a * ((1 - e * e / 4 - 3 * e * e * e * e / 64 - 5 * e * e * e * e * e * e / 256) * latRad
                 - (3 * e * e / 8 + 3 * e * e * e * e / 32 - 45 * e * e * e * e * e * e / 1024) * Math.sin(2 * latRad)
                 + (15 * e * e * e * e / 256 - 45 * e * e * e * e * e * e / 1024) * Math.sin(4 * latRad)
                 - (35 * e * e * e * e * e * e / 3072) * Math.sin(6 * latRad));
    
    const x = k0 * n * (a2 + (a2 * a2 * a2 / 6) * (1 - t + c)
                      + (a2 * a2 * a2 * a2 * a2 / 120) * (5 - 18 * t + t * t + 72 * c - 58 * e2)) + 500000;
    
    const y = k0 * (m + n * Math.tan(latRad) * (a2 * a2 / 2
                  + (a2 * a2 * a2 * a2 / 24) * (5 - t + 9 * c + 4 * c * c)
                  + (a2 * a2 * a2 * a2 * a2 * a2 / 720) * (61 - 58 * t + t * t + 600 * c - 330 * e2)));
    
    const hemisphere = lat >= 0 ? 'N' : 'S';
    return { x: x.toFixed(2), y: y.toFixed(2), zone: `${zoneNumber}${hemisphere}` };
}

// Convert Lat/Lon to Local XYZ (relative to first point)
function latLonToLocalXYZ(lat, lon, accuracy) {
    if (!referencePoint) {
        referencePoint = { lat, lon };
    }
    
    const R = 6371000; // Earth radius in meters
    const lat1 = referencePoint.lat * Math.PI / 180;
    const lat2 = lat * Math.PI / 180;
    const dLat = (lat - referencePoint.lat) * Math.PI / 180;
    const dLon = (lon - referencePoint.lon) * Math.PI / 180;
    
    const x = R * dLon * Math.cos((lat1 + lat2) / 2);
    const y = R * dLat;
    const z = accuracy; // Use accuracy as Z (height uncertainty)
    
    return { x: x.toFixed(3), y: y.toFixed(3), z: z.toFixed(3) };
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

            // Calculate UTM and Local XYZ
            const utm = latLonToUTM(latitude, longitude);
            const localXYZ = latLonToLocalXYZ(latitude, longitude, accuracy);

            // Update UI (No colors, just pure data)
            document.getElementById('live-accuracy').textContent = `± ${accuracy.toFixed(1)} m`;
            document.getElementById('live-coords').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            
            // Show transformed coordinates if element exists
            const transformedCoordsEl = document.getElementById('live-transformed');
            if (transformedCoordsEl) {
                transformedCoordsEl.innerHTML = `<strong>UTM:</strong> ${utm.zone} ${utm.x}, ${utm.y}<br><strong>Local XYZ:</strong> X: ${localXYZ.x}m, Y: ${localXYZ.y}m, Z: ${localXYZ.z}m`;
            }
            
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

// Record Point with 30-second delay
document.getElementById('btn-record').addEventListener('click', () => {
    if (!currentPosition || isCountingDown) return;

    isCountingDown = true;
    const btnRecord = document.getElementById('btn-record');
    let timeLeft = 30;

    btnRecord.classList.add('btn-counting');
    btnRecord.innerHTML = `WAIT: ${timeLeft}s`;
    
    const countdownInterval = setInterval(() => {
        timeLeft--;
        
        if (timeLeft > 0) {
            btnRecord.innerHTML = `WAIT: ${timeLeft}s`;
        } else {
            clearInterval(countdownInterval);

            // Calculate transforms
            const utm = latLonToUTM(currentPosition.coords.latitude, currentPosition.coords.longitude);
            const localXYZ = latLonToLocalXYZ(currentPosition.coords.latitude, currentPosition.coords.longitude, currentPosition.coords.accuracy);

            // Record the point with all coordinate systems
            const pt = {
                id: points.length + 1,
                lat: currentPosition.coords.latitude,
                lon: currentPosition.coords.longitude,
                acc: currentPosition.coords.accuracy,
                time: new Date().toLocaleTimeString(),
                utm: utm,
                localXYZ: localXYZ
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
        li.innerHTML = `<span>PT ${p.id}</span><span style="font-size:0.75rem;color:#71717a">Lat/Lon: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>UTM: ${p.utm.zone} ${p.utm.x}, ${p.utm.y}<br>Local XYZ: ${p.localXYZ.x}, ${p.localXYZ.y}, ${p.localXYZ.z}</span>`;
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

// Export CSV with all coordinate systems
document.getElementById('btn-export').addEventListener('click', () => {
    if (points.length === 0) return alert("No data");
    
    let csv = "PointID,Lat,Lon,Accuracy_m,Time,UTM_Zone,UTM_X,UTM_Y,Local_X_m,Local_Y_m,Local_Z_m\n";
    points.forEach(p => {
        csv += `${p.id},${p.lat},${p.lon},${p.acc},${p.time},${p.utm.zone},${p.utm.x},${p.utm.y},${p.localXYZ.x},${p.localXYZ.y},${p.localXYZ.z}\n`;
    });
    
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
        referencePoint = null;
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        updateUI();
    }
});

// Initialize
window.onload = () => {
    initMap();
    startTracking();
};
