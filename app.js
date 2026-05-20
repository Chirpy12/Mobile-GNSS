// Global State
let points = [];
let map, currentPosMarker, polygonLayer;
let pointMarkers = [];
let currentPosition = null;
let isCountingDown = false;
let referencePoint = null; // Reference point for local XYZ calculations

// PRS92 Parameters (Philippine Transverse Mercator Zone 3)
const PRS92_ZONE3 = {
    lat0: 0,           // Central latitude
    lon0: 121,         // Central meridian (Zone 3)
    k0: 0.99995,       // Scale factor
    fe: 500000,        // False easting
    fn: 0,             // False northing
    a: 6378245,        // Krassovsky ellipsoid semi-major axis
    b: 6356863.019,    // Krassovsky ellipsoid semi-minor axis
};

// WGS84 ellipsoid parameters
const WGS84 = {
    a: 6378137.0,      // Earth's semi-major axis (meters)
    b: 6356752.314245, // Earth's semi-minor axis (meters)
};

// Convert WGS84 (lat/lon) to PRS92 (PTM Zone 3)
function wgs84ToPRS92(lat, lon) {
    const params = PRS92_ZONE3;
    
    // Convert to radians
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const lon0Rad = params.lon0 * Math.PI / 180;
    
    // Calculate eccentricity
    const e2 = 1 - (params.b * params.b) / (params.a * params.a);
    const e = Math.sqrt(e2);
    
    // Calculate N (radius of curvature in prime vertical)
    const N = params.a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
    
    // Calculate T and C
    const T = Math.tan(latRad) * Math.tan(latRad);
    const C = e2 * Math.cos(latRad) * Math.cos(latRad) / (1 - e2);
    const A = Math.cos(latRad) * (lonRad - lon0Rad);
    
    // Calculate M (meridional arc)
    const M = params.a * ((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * latRad
        - (3*e2/8 + 3*e2*e2/32 - 45*e2*e2*e2/1024) * Math.sin(2*latRad)
        + (15*e2*e2/256 - 45*e2*e2*e2/1024) * Math.sin(4*latRad)
        - (35*e2*e2*e2/3072) * Math.sin(6*latRad));
    
    // Calculate UTM/PRS92 coordinates
    const easting = params.k0 * N * (A + A*A*A/6 * (1 - T + C) + A*A*A*A*A/120 * (5 - 18*T + T*T + 72*C - 58*e2)) + params.fe;
    const northing = params.k0 * (M + N * Math.tan(latRad) * (A*A/2 + A*A*A*A/24 * (5 - T + 9*C + 4*C*C) + A*A*A*A*A*A/720 * (61 - 58*T + T*T + 600*C - 330*e2))) + params.fn;
    
    return {
        easting: easting.toFixed(2),
        northing: northing.toFixed(2),
        zone: 3
    };
}

// Convert WGS84 to local XYZ (relative to first point)
function wgs84ToLocalXYZ(lat, lon, accuracy) {
    if (!referencePoint) {
        return { x: 0, y: 0, z: 0 };
    }
    
    // Simple Cartesian approximation (good for small areas)
    const latDiff = (lat - referencePoint.lat) * 111320; // meters per degree latitude
    const lonDiff = (lon - referencePoint.lon) * 111320 * Math.cos(lat * Math.PI / 180); // meters per degree longitude
    
    return {
        x: lonDiff.toFixed(2),    // East
        y: latDiff.toFixed(2),    // North
        z: accuracy.toFixed(2)    // Height uncertainty
    };
}

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

            // Set reference point on first read
            if (!referencePoint) {
                referencePoint = { lat: latitude, lon: longitude };
            }

            // Update UI with all three coordinate systems
            document.getElementById('live-accuracy').textContent = `± ${accuracy.toFixed(1)} m`;
            document.getElementById('live-coords').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            
            // Get PRS92 coordinates
            const prs92 = wgs84ToPRS92(latitude, longitude);
            document.getElementById('live-prs92').textContent = `E: ${prs92.easting}, N: ${prs92.northing}`;
            
            // Get local XYZ
            const xyz = wgs84ToLocalXYZ(latitude, longitude, accuracy);
            document.getElementById('live-xyz').textContent = `X: ${xyz.x}m, Y: ${xyz.y}m, Z: ±${xyz.z}m`;
            
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

            // Get all coordinate systems
            const prs92 = wgs84ToPRS92(currentPosition.coords.latitude, currentPosition.coords.longitude);
            const xyz = wgs84ToLocalXYZ(currentPosition.coords.latitude, currentPosition.coords.longitude, currentPosition.coords.accuracy);

            // Record the point
            const pt = {
                id: points.length + 1,
                lat: currentPosition.coords.latitude,
                lon: currentPosition.coords.longitude,
                acc: currentPosition.coords.accuracy,
                time: new Date().toLocaleTimeString(),
                prs92Easting: prs92.easting,
                prs92Northing: prs92.northing,
                xyzX: xyz.x,
                xyzY: xyz.y,
                xyzZ: xyz.z
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
        li.innerHTML = `
            <div class="point-item">
                <div class="point-header">PT ${p.id} [±${p.acc.toFixed(1)}m] ${p.time}</div>
                <div class="point-coords">
                    <div>WGS84: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
                    <div>PRS92: E ${p.prs92Easting}, N ${p.prs92Northing}</div>
                    <div>Local XYZ: X ${p.xyzX}m, Y ${p.xyzY}m, Z ±${p.xyzZ}m</div>
                </div>
            </div>
        `;
        list.appendChild(li);

        // Minimalist Map Markers
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
    
    // Draw Monochrome Polygon
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
    let csv = "PointID,Lat_WGS84,Lon_WGS84,Accuracy_m,Time,PRS92_Easting,PRS92_Northing,XYZ_X_m,XYZ_Y_m,XYZ_Z_m\n";
    points.forEach(p => csv += `${p.id},${p.lat},${p.lon},${p.acc},${p.time},${p.prs92Easting},${p.prs92Northing},${p.xyzX},${p.xyzY},${p.xyzZ}\n`);
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `gnss_data_${new Date().getTime()}.csv`);
    a.click();
});

// Clear Data
document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("CLEAR ALL DATA?")) {
        points = [];
        referencePoint = null; // Reset reference point
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        updateUI();
    }
});

// Initialize
window.onload = () => {
    initMap();
    startTracking();
};
