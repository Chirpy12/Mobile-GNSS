// Global State
let points = [];
let map, currentPosMarker, polygonLayer;
let pointMarkers = [];
let currentPosition = null;

// Initialize Map
function initMap() {
    map = L.map('map').setView([14.6539, 121.0685], 15); // Default to UP Diliman
    
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

            // Update UI
            document.getElementById('live-accuracy').textContent = `± ${accuracy.toFixed(1)} m`;
            document.getElementById('live-coords').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            document.getElementById('status-indicator').classList.add('active');
            document.getElementById('btn-record').disabled = false;

            // Color code accuracy
            const accEl = document.getElementById('live-accuracy');
            if (accuracy < 5) accEl.style.color = 'var(--success)';
            else if (accuracy < 12) accEl.style.color = 'var(--warning)';
            else accEl.style.color = 'var(--danger)';

            // Update user blue dot
            if (!currentPosMarker) {
                currentPosMarker = L.circleMarker([latitude, longitude], {
                    radius: 7, fillColor: "#2563eb", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9
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

// Record Point
document.getElementById('btn-record').addEventListener('click', () => {
    if (!currentPosition) return;

    const pt = {
        id: points.length + 1,
        lat: currentPosition.coords.latitude,
        lon: currentPosition.coords.longitude,
        acc: currentPosition.coords.accuracy,
        time: new Date().toLocaleTimeString()
    };

    points.push(pt);
    updateUI();
});

// Update UI and Map Drawing
function updateUI() {
    const list = document.getElementById('point-list');
    document.getElementById('point-count').textContent = points.length;
    list.innerHTML = '';

    if (points.length === 0) {
        list.innerHTML = '<li class="empty-state">No points recorded.</li>';
    }

    // Clear old markers
    pointMarkers.forEach(m => map.removeLayer(m));
    pointMarkers = [];

    points.forEach(p => {
        // List Item
        const li = document.createElement('li');
        li.innerHTML = `<span><strong>Pt ${p.id}</strong> (±${p.acc.toFixed(1)}m)</span> <span>${p.time}</span>`;
        list.appendChild(li);

        // Map Marker
        const m = L.marker([p.lat, p.lon]).addTo(map)
            .bindPopup(`Point ${p.id}<br>Acc: ±${p.acc.toFixed(1)}m`);
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
    
    // Update Map Polygon
    if (polygonLayer) polygonLayer.setLatLngs(latlngs);
    else {
        polygonLayer = L.polygon(latlngs, { color: 'red', weight: 2, fillOpacity: 0.2 }).addTo(map);
    }
    map.fitBounds(polygonLayer.getBounds(), { padding: [20, 20] });

    // Turf Math (Note: Turf uses [Lon, Lat])
    const turfCoords = points.map(p => [p.lon, p.lat]);
    turfCoords.push(turfCoords[0]); // Close polygon
    const poly = turf.polygon([turfCoords]);
    const area = turf.area(poly);

    document.getElementById('area-display').textContent = `${area.toFixed(2)} m²`;
    document.getElementById('area-note').textContent = "Spherical Ellipsoid Calculation (Turf.js)";
}

// Export CSV
document.getElementById('btn-export').addEventListener('click', () => {
    if (points.length === 0) return alert("No data to export");
    let csv = "PointID,Lat,Lon,Accuracy_m,Time\n";
    points.forEach(p => csv += `${p.id},${p.lat},${p.lon},${p.acc},${p.time}\n`);
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `gnss_test_${Date.now()}.csv`);
    a.click();
});

// Clear Data
document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("Clear all data?")) {
        points = [];
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        updateUI();
    }
});

// Initialize on Load
window.onload = () => {
    initMap();
    startTracking();
};
