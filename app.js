// ============================================================
// Global State
// ============================================================
let points = [];
let map, currentPosMarker, polygonLayer;
let pointMarkers = [];
let currentPosition = null;
let isCountingDown = false;
let referencePoint = null;

// ============================================================
// LocalStorage Persistence
// ============================================================
const STORAGE_KEY = 'gnss_session';

function saveSession() {
    try {
        const session = {
            points,
            referencePoint,
            savedAt: new Date().toISOString()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
        console.warn('Autosave failed:', e);
    }
}

function loadSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const session = JSON.parse(raw);
        if (!session.points || session.points.length === 0) return false;
        points = session.points;
        referencePoint = session.referencePoint || null;
        return session.savedAt || true;
    } catch (e) {
        console.warn('Session restore failed:', e);
        return false;
    }
}

function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3500);
}

// ============================================================
// Kalman Filter (2D position + velocity)
// State: [lat, lon, vLat, vLon]
// ============================================================
class GNSSKalmanFilter {
    constructor() { this.reset(); }

    reset() {
        this.initialized = false;
        this.x = null;
        this.P = null;
        this.lastTime = null;
    }

    matMul(A, B) {
        const rows = A.length, cols = B[0].length, inner = B.length;
        return Array.from({ length: rows }, (_, i) =>
            Array.from({ length: cols }, (_, j) =>
                A[i].reduce((sum, _, k) => sum + A[i][k] * B[k][j], 0)
            )
        );
    }
    matAdd(A, B) { return A.map((r, i) => r.map((v, j) => v + B[i][j])); }
    matSub(A, B) { return A.map((r, i) => r.map((v, j) => v - B[i][j])); }
    transpose(A) { return A[0].map((_, j) => A.map(r => r[j])); }

    init(lat, lon, accuracy) {
        const s = accuracy;
        this.x = [[lat], [lon], [0], [0]];
        this.P = [
            [s*s, 0, 0, 0],
            [0, s*s, 0, 0],
            [0, 0, 1,  0],
            [0, 0, 0,  1]
        ];
        this.lastTime = Date.now();
        this.initialized = true;
    }

    update(lat, lon, accuracy) {
        if (!this.initialized) {
            this.init(lat, lon, accuracy);
            return { lat, lon };
        }

        const dt = Math.min((Date.now() - this.lastTime) / 1000, 2.0);
        this.lastTime = Date.now();

        // State transition
        const F = [
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1,  0],
            [0, 0, 0,  1]
        ];

        // Process noise
        const q = 0.0001;
        const Q = [
            [q*dt*dt, 0,       q*dt, 0   ],
            [0,       q*dt*dt, 0,    q*dt],
            [q*dt,    0,       q,    0   ],
            [0,       q*dt,    0,    q   ]
        ];

        const x_pred = this.matMul(F, this.x);
        const P_pred = this.matAdd(
            this.matMul(this.matMul(F, this.P), this.transpose(F)), Q
        );

        // Measurement (lat, lon only)
        const H = [[1,0,0,0],[0,1,0,0]];
        const r = accuracy * accuracy;
        const R = [[r,0],[0,r]];

        const z = [[lat],[lon]];
        const y = this.matSub(z, this.matMul(H, x_pred));
        const S = this.matAdd(
            this.matMul(this.matMul(H, P_pred), this.transpose(H)), R
        );

        // 2x2 inverse
        const det = S[0][0]*S[1][1] - S[0][1]*S[1][0];
        const S_inv = [
            [ S[1][1]/det, -S[0][1]/det],
            [-S[1][0]/det,  S[0][0]/det]
        ];

        const K = this.matMul(this.matMul(P_pred, this.transpose(H)), S_inv);
        this.x = this.matAdd(x_pred, this.matMul(K, y));

        const I4 = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
        this.P = this.matMul(this.matSub(I4, this.matMul(K, H)), P_pred);

        return { lat: this.x[0][0], lon: this.x[1][0] };
    }
}

const liveKalman = new GNSSKalmanFilter();
let countdownKalman = null;
let countdownBestEstimate = null;

// ============================================================
// PRS92 (PTM Zone 3)
// ============================================================
const PRS92_ZONE3 = {
    lon0: 121, k0: 0.99995, fe: 500000, fn: 0,
    a: 6378245, b: 6356863.019
};

function wgs84ToPRS92(lat, lon) {
    const p = PRS92_ZONE3;
    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const l0R  = p.lon0 * Math.PI / 180;
    const e2 = 1 - (p.b*p.b)/(p.a*p.a);
    const N  = p.a / Math.sqrt(1 - e2*Math.sin(latR)**2);
    const T  = Math.tan(latR)**2;
    const C  = e2*Math.cos(latR)**2/(1-e2);
    const A  = Math.cos(latR)*(lonR-l0R);
    const M  = p.a*(
        (1-e2/4-3*e2**2/64-5*e2**3/256)*latR
        -(3*e2/8+3*e2**2/32-45*e2**3/1024)*Math.sin(2*latR)
        +(15*e2**2/256-45*e2**3/1024)*Math.sin(4*latR)
        -(35*e2**3/3072)*Math.sin(6*latR)
    );
    const E = p.k0*N*(A+A**3/6*(1-T+C)+A**5/120*(5-18*T+T**2+72*C-58*e2))+p.fe;
    const Nv= p.k0*(M+N*Math.tan(latR)*(A**2/2+A**4/24*(5-T+9*C+4*C**2)+A**6/720*(61-58*T+T**2+600*C-330*e2)))+p.fn;
    return { easting: E.toFixed(2), northing: Nv.toFixed(2) };
}

// ============================================================
// Local XYZ
// ============================================================
function wgs84ToLocalXYZ(lat, lon, alt) {
    if (!referencePoint || points.length === 0) {
        referencePoint = { lat, lon, alt: alt !== null ? alt : 0 };
        return { x: "0.00", y: "0.00", z: "0.00" };
    }
    const dX = (lon - referencePoint.lon) * 111320 * Math.cos(lat * Math.PI / 180);
    const dY = (lat - referencePoint.lat) * 111320;
    const dZ = (alt !== null && referencePoint.alt !== null) ? alt - referencePoint.alt : 0;
    return { x: dX.toFixed(2), y: dY.toFixed(2), z: dZ.toFixed(2) };
}

// ============================================================
// HDOP
// ============================================================
function estimateHDOP(accuracy) { return accuracy / 5; }
function hdopLabel(hdop) {
    if (hdop <= 1)  return "Excellent";
    if (hdop <= 2)  return "Good";
    if (hdop <= 5)  return "Moderate";
    if (hdop <= 10) return "Fair";
    return "Poor";
}

// ============================================================
// Map
// ============================================================
function initMap() {
    map = L.map('map').setView([14.6539, 121.0685], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    }).addTo(map);
}

// ============================================================
// GPS Tracking
// ============================================================
function startTracking() {
    if (!navigator.geolocation) { alert("Geolocation not supported"); return; }

    navigator.geolocation.watchPosition(
        (pos) => {
            currentPosition = pos;
            const { latitude, longitude, accuracy, altitude } = pos.coords;

            liveKalman.update(latitude, longitude, accuracy);

            if (isCountingDown && countdownKalman) {
                countdownBestEstimate = countdownKalman.update(latitude, longitude, accuracy);
                countdownBestEstimate.altitude = altitude;
                countdownBestEstimate.accuracy = accuracy;
            }

            const hdop = estimateHDOP(accuracy);

            document.getElementById('live-accuracy').textContent = `± ${accuracy.toFixed(1)} m`;
            document.getElementById('live-coords').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            document.getElementById('live-hdop').textContent = `${hdop.toFixed(2)} (${hdopLabel(hdop)})`;

            const prs92 = wgs84ToPRS92(latitude, longitude);
            document.getElementById('live-prs92').textContent = `E: ${prs92.easting}, N: ${prs92.northing}`;

            if (referencePoint) {
                const dX = (longitude - referencePoint.lon) * 111320 * Math.cos(latitude * Math.PI / 180);
                const dY = (latitude - referencePoint.lat) * 111320;
                const dZ = (altitude !== null && referencePoint.alt !== null) ? altitude - referencePoint.alt : 0;
                document.getElementById('live-xyz').textContent =
                    `X: ${dX.toFixed(2)}m, Y: ${dY.toFixed(2)}m, Z: ${dZ.toFixed(2)}m`;
            } else {
                document.getElementById('live-xyz').textContent = `X: --, Y: --, Z: --`;
            }

            document.getElementById('status-indicator').classList.add('active');
            if (!isCountingDown) document.getElementById('btn-record').disabled = false;

            // Map dot — raw position
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

// ============================================================
// Record Point
// ============================================================
document.getElementById('btn-record').addEventListener('click', () => {
    if (!currentPosition || isCountingDown) return;

    isCountingDown = true;
    const btnRecord = document.getElementById('btn-record');
    let timeLeft = 30;

    // Fresh Kalman for this recording
    countdownKalman = new GNSSKalmanFilter();
    const { latitude, longitude, accuracy, altitude } = currentPosition.coords;
    countdownBestEstimate = countdownKalman.update(latitude, longitude, accuracy);
    countdownBestEstimate.altitude = altitude;
    countdownBestEstimate.accuracy = accuracy;

    btnRecord.classList.add('btn-counting');
    btnRecord.innerHTML = `WAIT: ${timeLeft}s`;

    const countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            btnRecord.innerHTML = `WAIT: ${timeLeft}s`;
        } else {
            clearInterval(countdownInterval);

            const filtLat = countdownBestEstimate.lat;
            const filtLon = countdownBestEstimate.lon;
            const filtAlt = countdownBestEstimate.altitude;
            const filtAcc = countdownBestEstimate.accuracy;

            const prs92 = wgs84ToPRS92(filtLat, filtLon);
            const xyz   = wgs84ToLocalXYZ(filtLat, filtLon, filtAlt);
            const hdop  = estimateHDOP(filtAcc);

            const pt = {
                id: points.length + 1,
                lat: filtLat,
                lon: filtLon,
                alt: filtAlt,
                acc: filtAcc,
                hdop,
                time: new Date().toLocaleTimeString(),
                prs92Easting:  prs92.easting,
                prs92Northing: prs92.northing,
                xyzX: xyz.x,
                xyzY: xyz.y,
                xyzZ: xyz.z
            };

            points.push(pt);
            saveSession(); // ← autosave after every recorded point

            countdownKalman = null;
            countdownBestEstimate = null;

            updateUI();

            btnRecord.classList.remove('btn-counting');
            btnRecord.innerHTML = `RECORD POINT`;
            isCountingDown = false;

            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        }
    }, 1000);
});

// ============================================================
// UI Update
// ============================================================
function updateUI() {
    const list = document.getElementById('point-list');
    document.getElementById('point-count').textContent = points.length;
    list.innerHTML = '';

    if (points.length === 0) {
        list.innerHTML = '<li class="empty-state">NO POINTS</li>';
        document.getElementById('area-display').textContent = "0.00 m²";
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        pointMarkers.forEach(m => map.removeLayer(m));
        pointMarkers = [];
        return;
    }

    pointMarkers.forEach(m => map.removeLayer(m));
    pointMarkers = [];

    points.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="point-item">
                <div class="point-header">PT ${p.id} [±${p.acc.toFixed(1)}m | HDOP ${p.hdop.toFixed(2)}] ${p.time}</div>
                <div class="point-coords">
                    <div>WGS84: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
                    <div>PRS92: E ${p.prs92Easting}, N ${p.prs92Northing}</div>
                    <div>Local XYZ: X ${p.xyzX}m, Y ${p.xyzY}m, Z ${p.xyzZ}m</div>
                </div>
            </div>
        `;
        list.appendChild(li);

        const m = L.circleMarker([p.lat, p.lon], {
            radius: 5, fillColor: "#fff", color: "#000", weight: 2, fillOpacity: 1
        }).addTo(map);
        pointMarkers.push(m);
    });

    calculateArea();
}

// ============================================================
// Area
// ============================================================
function calculateArea() {
    if (points.length < 3) {
        document.getElementById('area-display').textContent = "0.00 m²";
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        return;
    }
    const latlngs = points.map(p => [p.lat, p.lon]);
    if (polygonLayer) polygonLayer.setLatLngs(latlngs);
    else {
        polygonLayer = L.polygon(latlngs, {
            color: '#000', weight: 2, fillColor: '#000', fillOpacity: 0.1
        }).addTo(map);
    }
    map.fitBounds(polygonLayer.getBounds(), { padding: [20, 20] });
    const turfCoords = points.map(p => [p.lon, p.lat]);
    turfCoords.push(turfCoords[0]);
    const area = turf.area(turf.polygon([turfCoords]));
    document.getElementById('area-display').textContent = `${area.toFixed(2)} m²`;
}

// ============================================================
// CSV Export
// ============================================================
document.getElementById('btn-export').addEventListener('click', () => {
    if (points.length === 0) return alert("No data");
    let csv = "PointID,Lat_WGS84,Lon_WGS84,Alt_WGS84_m,Accuracy_m,HDOP_est,Time,PRS92_Easting,PRS92_Northing,XYZ_X_m,XYZ_Y_m,XYZ_Z_m\n";
    points.forEach(p => {
        const altVal = p.alt !== null ? p.alt.toFixed(3) : "N/A";
        csv += `${p.id},${p.lat},${p.lon},${altVal},${p.acc.toFixed(3)},${p.hdop.toFixed(2)},${p.time},${p.prs92Easting},${p.prs92Northing},${p.xyzX},${p.xyzY},${p.xyzZ}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `gnss_data_${new Date().getTime()}.csv`);
    a.click();
});

// ============================================================
// Clear
// ============================================================
document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm("CLEAR ALL DATA? This will also delete the autosaved session.")) {
        points = [];
        referencePoint = null;
        liveKalman.reset();
        clearSession(); // ← wipe localStorage
        if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
        updateUI();
        showToast("Session cleared.");
    }
});

// ============================================================
// Init
// ============================================================
window.onload = () => {
    initMap();

    // Restore previous session if available
    const savedAt = loadSession();
    if (savedAt) {
        updateUI();
        const timeStr = typeof savedAt === 'string'
            ? new Date(savedAt).toLocaleTimeString()
            : '';
        showToast(`Session restored — ${points.length} point${points.length !== 1 ? 's' : ''} recovered${timeStr ? ' (saved ' + timeStr + ')' : ''}.`);
    }

    startTracking();
};
