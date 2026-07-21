// --- 1. SETUP ENVIRONMENT ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 220;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 120;
controls.maxDistance = 400;

// Clickable globe features for environmental sustainability inspection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let clickMarker = null;

// --- 2. LIGHTING (tuned for vegetation) ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambientLight);

// Hemisphere light gives nice bounce light — sky blue above, soft green ground for lush vegetation feel
const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f2a, 0.6);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff8e7, 1.15);
sunLight.position.set(5, 3, 5).normalize();
scene.add(sunLight);

// --- 3. TWINKLING STARS BACKGROUND ---
const starCount = 1500;
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(starCount * 3);
const starSizes = new Float32Array(starCount);

for (let i = 0; i < starCount * 3; i += 3) {
    // Distribute stars over a large sphere
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = 500 + Math.random() * 300; 

    starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i+1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i+2] = r * Math.cos(phi);
    
    starSizes[i/3] = Math.random() * 2.0;
}

starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));

// Star Material supporting twinkling effects via uniform
const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
});

const starField = new THREE.Points(starGeometry, starMaterial);
scene.add(starField);

// --- 4. REALISTIC EARTH TEXTURE + TERRAIN + OCEAN SHININESS ---
// Accurate continents + real biomes. Adds bump map for terrain relief
// (mountains, ridges) and specular/roughness map for shiny oceans.
// Uses PhysicalMaterial + tuned lighting for rich vegetation appearance.
const textureLoader = new THREE.TextureLoader();

const globeGeometry = new THREE.SphereGeometry(60, 96, 96);

// Seasonal state variables (must be declared before any use)
let colorTexture = null;
let bumpTexture = null;
let specularTexture = null;
let transitionSphere = null;
let currentSeason = 6;
let isSeasonPlaying = false;
let seasonPlayInterval = null;
let seasonTransition = null;

// #2 Vegetation glow + EE integration state (declared early)
let vegetationGlow = 0.22;
let currentEELayer = 'bmng';
let showLandCover = true;
let showPrecip = false;
let showTemp = false;
let showPlanted = false;
let showTreeGain = false;
let showForestExtent = false;
let showAlerts = false;
let ndviTexture = null;
let treeCoverTexture = null;
let landCoverTexture = null;
let forestLossTexture = null;
let nightLightsTexture = null;
let precipTexture = null;
let tempTexture = null;
let plantedForestsTexture = null;
let treeGainTexture = null;
let forestExtentTexture = null;
let alertsTexture = null;
let soilCarbonTexture = null;
let biomassTexture = null;
let biodiversityTexture = null;

// Simulation scenario multipliers (for future platform)
let simDeforest = 0;
let simWarm = 0;

// Temporary dark ocean while textures load
const globeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0a1f3d,
    roughness: 0.9,
    metalness: 0.0
});

const globe = new THREE.Mesh(globeGeometry, globeMaterial);
scene.add(globe);

// Transition sphere for smooth seasonal crossfades (shows the glorious changing vegetation)
const transitionMaterial = new THREE.MeshPhysicalMaterial({
    transparent: true,
    opacity: 0,
    roughness: 0.85,
    metalness: 0.0,
    bumpScale: 0.85,
    clearcoat: 0.14,
    clearcoatRoughness: 0.38
});
transitionSphere = new THREE.Mesh(globeGeometry, transitionMaterial);
transitionSphere.visible = false;
transitionSphere.rotation.y = 2.5;
scene.add(transitionSphere);

// Initial orientation
globe.rotation.y = 2.5;

// (Seasonal variables declared earlier to avoid TDZ issues)

function configureTexture(tex) {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
}

function createRoughnessMapFromSpecular(specTex) {
    if (!specTex || !specTex.image) return null;
    const img = specTex.image;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Invert so oceans (typically bright in specular maps) become low roughness (shiny)
    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const inverted = 255 - gray;
        data[i]     = inverted;
        data[i + 1] = inverted;
        data[i + 2] = inverted;
    }
    ctx.putImageData(imageData, 0, 0);

    const roughnessTex = new THREE.CanvasTexture(canvas);
    return configureTexture(roughnessTex);
}

function applyEarthMaterial() {
    // Determine active color based on EE layer selection
    let activeColor = colorTexture || monthlyColorTextures[currentSeason];
    if (showLandCover && landCoverTexture) {
        activeColor = landCoverTexture;
    } else if (currentEELayer === 'ndvi' && ndviTexture) {
        activeColor = ndviTexture;
    } else if (currentEELayer === 'treecover' && treeCoverTexture) {
        activeColor = treeCoverTexture;
    } else if (currentEELayer === 'forestloss' && forestLossTexture) {
        activeColor = forestLossTexture;
    } else if (currentEELayer === 'nightlights' && nightLightsTexture) {
        activeColor = nightLightsTexture;
    } else if (currentEELayer === 'planted' && plantedForestsTexture) {
        activeColor = plantedForestsTexture;
    } else if (currentEELayer === 'treegain' && treeGainTexture) {
        activeColor = treeGainTexture;
    } else if (currentEELayer === 'forestextent' && forestExtentTexture) {
        activeColor = forestExtentTexture;
    } else if (showForestExtent && forestExtentTexture) {
        activeColor = forestExtentTexture;
    } else if (currentEELayer === 'soilcarbon' && soilCarbonTexture) {
        activeColor = soilCarbonTexture;
    } else if (currentEELayer === 'biomass' && biomassTexture) {
        activeColor = biomassTexture;
    } else if (currentEELayer === 'biodiversity' && biodiversityTexture) {
        activeColor = biodiversityTexture;
    }
    // 'bmng' or fallback uses seasonal BMNG
    // Note: precip/temp/alerts primarily affect emissive overlays (additive data layers for sustainability metrics)

    if (!activeColor) return;

    // MeshPhysicalMaterial for improved vegetation rendering
    // clearcoat gives subtle leaf-like sheen and specular highlights on plant life
    const mat = new THREE.MeshPhysicalMaterial({
        map: activeColor,
        roughness: 0.82,
        metalness: 0.0,
        clearcoat: 0.14,
        clearcoatRoughness: 0.38
    });

    if (bumpTexture) {
        mat.bumpMap = bumpTexture;
        mat.bumpScale = 0.85;   // visible relief without exaggeration
    }

    if (specularTexture) {
        const roughnessMap = createRoughnessMapFromSpecular(specularTexture);
        if (roughnessMap) {
            mat.roughnessMap = roughnessMap;
            mat.roughness = 1.0;   // let the map control roughness fully
        }
    }

    // Apply to main globe
    globe.material = mat;

    // If we have a seasonal color, also make sure the transition sphere can inherit properties later
    if (monthlyColorTextures[currentSeason]) {
        colorTexture = activeColor;
    }

    // Prepare transition sphere's shared properties (bump + roughness + clearcoat) for beautiful future crossfades
    if (transitionSphere && transitionSphere.material) {
        const tmat = transitionSphere.material;
        tmat.bumpMap = mat.bumpMap || null;
        tmat.roughnessMap = mat.roughnessMap || null;
        tmat.bumpScale = 0.85;
        tmat.clearcoat = 0.14;
        tmat.clearcoatRoughness = 0.38;
        tmat.needsUpdate = true;
    }

    // Apply vegetation glow / density emphasis (#2)
    // Use tree cover or ndvi for density if available (from EE datasets)
    applyEmissiveToMaterial(mat);

    // Update live GFW-style analysis stats
    updateAnalysisStats();

    // Simple land cover classification tint + additional data layer effects (MCD12 + others)
    // For full sustainability platform, these can drive simulation parameters (e.g. "available biomass")
    if (showLandCover && landCoverTexture) {
        mat.emissive = mat.emissive.clone().add(new THREE.Color(0x224422).multiplyScalar(0.15));
    }
    if (forestLossTexture && currentEELayer !== 'bmng') {
        // Visual hint of loss areas - modulated by sim
        let lossVis = 0.1 + simDeforest * 0.4;
        mat.emissive = mat.emissive.clone().add(new THREE.Color(0x660000).multiplyScalar(lossVis));
    }
    if (plantedForestsTexture && (showPlanted || currentEELayer === 'planted')) {
        // Highlight planted areas distinctly (useful for distinguishing sustainable vs conversion risk in sims)
        mat.emissive = mat.emissive.clone().add(new THREE.Color(0x228b22).multiplyScalar(0.2));
    }
    if (treeGainTexture && showTreeGain) {
        // Extra boost for gain areas
        mat.emissive = mat.emissive.clone().add(new THREE.Color(0x00ff7f).multiplyScalar(0.15));
    }
    if (alertsTexture && showAlerts) {
        // Hotspots for alerts
        mat.emissive = mat.emissive.clone().add(new THREE.Color(0xff4500).multiplyScalar(0.25));
    }
}

// --- SEASONAL PLANT LIFE: Blue Marble Next Generation (Monthly) ---
// These NASA textures beautifully capture the changing splendor of Earth's vegetation
// through the seasons — green-up in spring, peak biomass in summer, and retreat in winter.
const months = [
    { name: "January",  short: "Jan",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/january/world.topo.200401.3x5400x2700.jpg" },
    { name: "February", short: "Feb",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/february/world.topo.200402.3x5400x2700.jpg" },
    { name: "March",    short: "Mar",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/march/world.topo.200403.3x5400x2700.jpg" },
    { name: "April",    short: "Apr",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/april/world.topo.200404.3x5400x2700.jpg" },
    { name: "May",      short: "May",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/may/world.topo.200405.3x5400x2700.jpg" },
    { name: "June",     short: "Jun",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/june/world.topo.200406.3x5400x2700.jpg" },
    { name: "July",     short: "Jul",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/july/world.topo.200407.3x5400x2700.jpg" },
    { name: "August",   short: "Aug",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/august/world.topo.200408.3x5400x2700.jpg" },
    { name: "September",short: "Sep",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/september/world.topo.200409.3x5400x2700.jpg" },
    { name: "October",  short: "Oct",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/october/world.topo.200410.3x5400x2700.jpg" },
    { name: "November", short: "Nov",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/november/world.topo.200411.3x5400x2700.jpg" },
    { name: "December", short: "Dec",  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/december/world.topo.200412.3x5400x2700.jpg" }
];

const monthlyColorTextures = new Array(12).fill(null);

// Preload all 12 monthly BMNG textures for smooth seasonal cycling
function preloadMonthlyTextures() {
    months.forEach((month, index) => {
        textureLoader.load(
            month.url,
            function (texture) {
                monthlyColorTextures[index] = configureTexture(texture);
                // If this is the initial season, apply it now
                if (index === currentSeason && colorTexture === null) {
                    colorTexture = monthlyColorTextures[index];
                    applyEarthMaterial();
                }
            },
            undefined,
            function () {
                console.warn('Failed to load seasonal texture for', month.name);
            }
        );
    });
}

// Smoothly crossfade to a new season to showcase Earth's changing plant life
function setSeason(monthIndex, transitionMs = 900) {
    if (monthIndex < 0 || monthIndex > 11) return;
    if (monthIndex === currentSeason) return;
    if (!monthlyColorTextures[monthIndex]) {
        // Texture not ready yet — apply as soon as it loads
        console.log('Waiting for seasonal texture to load...');
        return;
    }

    const targetTexture = monthlyColorTextures[monthIndex];
    const targetMonth = months[monthIndex];

    // Keep the transition sphere in sync with user rotation
    transitionSphere.rotation.copy(globe.rotation);

    // Prepare transition sphere with the new vegetation map + shared bump/roughness + clearcoat
    const transMat = transitionSphere.material;
    transMat.map = targetTexture;
    transMat.bumpMap = globe.material.bumpMap || null;
    transMat.roughnessMap = globe.material.roughnessMap || null;
    transMat.bumpScale = 0.85;
    transMat.clearcoat = 0.14;
    transMat.clearcoatRoughness = 0.38;
    transMat.needsUpdate = true;

    // Apply current vegetation glow to the transitioning layer
    applyEmissiveToMaterial(transMat);

    transitionSphere.visible = true;
    transitionSphere.material.opacity = 0;

    // Make main globe able to fade
    if (!globe.material.transparent) {
        globe.material.transparent = true;
    }

    const startTime = performance.now();
    const startOpacity = globe.material.opacity ?? 1;

    // Cancel any previous transition
    if (seasonTransition) cancelAnimationFrame(seasonTransition);

    function animateTransition() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / transitionMs, 1);
        // Ease in-out
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        globe.material.opacity = startOpacity * (1 - eased);
        transitionSphere.material.opacity = eased;

        if (t < 1) {
            seasonTransition = requestAnimationFrame(animateTransition);
        } else {
            // Finish the crossfade — re-apply full material (respects current EE layer selection)
            currentSeason = monthIndex;
            colorTexture = targetTexture;
            applyEarthMaterial();

            transitionSphere.visible = false;
            transitionSphere.material.opacity = 0;

            // Update UI
            updateSeasonUI();

            seasonTransition = null;
        }
    }

    seasonTransition = requestAnimationFrame(animateTransition);
}

function updateSeasonUI() {
    const label = document.getElementById('season-label');
    const slider = document.getElementById('season-slider');
    if (!label || !slider) return;

    const m = months[currentSeason];
    let desc = m.name;
    if (currentSeason === 6) desc += " — Peak Northern Summer Greenery";
    else if (currentSeason === 0 || currentSeason === 11) desc += " — Winter Retreat";
    else if (currentSeason === 3 || currentSeason === 4) desc += " — Spring Green-Up";

    label.textContent = desc;
    slider.value = currentSeason;
}

function toggleSeasonPlay() {
    const btn = document.getElementById('season-play');
    isSeasonPlaying = !isSeasonPlaying;

    if (isSeasonPlaying) {
        btn.textContent = '⏸ Pause';
        btn.style.background = 'rgba(163, 230, 53, 0.25)';

        // Cycle through all months with nice crossfades
        seasonPlayInterval = setInterval(() => {
            let next = (currentSeason + 1) % 12;
            setSeason(next, 1100);
        }, 2800); // ~2.8s per month — enough time to appreciate the vegetation changes
    } else {
        btn.textContent = '▶ Play Seasons';
        btn.style.background = 'rgba(163, 230, 53, 0.15)';
        if (seasonPlayInterval) {
            clearInterval(seasonPlayInterval);
            seasonPlayInterval = null;
        }
    }
}

function resetSeason() {
    if (isSeasonPlaying) {
        const btn = document.getElementById('season-play');
        isSeasonPlaying = false;
        btn.textContent = '▶ Play Seasons';
        btn.style.background = 'rgba(163, 230, 53, 0.15)';
        if (seasonPlayInterval) clearInterval(seasonPlayInterval);
    }
    setSeason(6, 700); // July — the most glorious vegetation
}

// --- #2 Vegetation Density / Glow (emphasizes plant life splendor) ---

function updateVegetationGlow(intensity) {
    vegetationGlow = Math.max(0, Math.min(1, intensity));

    // Update main globe if it has a map
    if (globe && globe.material && globe.material.map) {
        applyEmissiveToMaterial(globe.material);
    }

    // Update transition sphere during fades for consistent look
    if (transitionSphere && transitionSphere.visible && transitionSphere.material && transitionSphere.material.map) {
        applyEmissiveToMaterial(transitionSphere.material);
    }
}

function applyEmissiveToMaterial(mat) {
    if (!mat.map) return;

    // Base emissive from current EE layer selection
    let emissiveSource = mat.map;
    if (currentEELayer === 'treecover' && treeCoverTexture) {
        emissiveSource = treeCoverTexture;
    } else if (currentEELayer === 'ndvi' && ndviTexture) {
        emissiveSource = ndviTexture;
    } else if (currentEELayer === 'treegain' && treeGainTexture) {
        emissiveSource = treeGainTexture;
    } else if (currentEELayer === 'forestextent' && forestExtentTexture) {
        emissiveSource = forestExtentTexture;
    } else if (mat.map) {
        emissiveSource = mat.map;
    }

    mat.emissiveMap = emissiveSource;

    // Base lively green for plant life
    let emissiveColor = new THREE.Color(0x4ade80).multiplyScalar(vegetationGlow);

    // Layer additional EE datasets for sustainability indicators (multiplicative tints)
    if (forestLossTexture && showLandCover) {
        // Red shift for deforestation / forest loss (Hansen) - amplified by sim
        let lossIntensity = 0.3 + simDeforest * 0.7;
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x8B0000).multiplyScalar(lossIntensity));
    }
    if (nightLightsTexture) {
        // Add warm urban glow from lights (human footprint)
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0xffaa00).multiplyScalar(0.15));
    }
    if (precipTexture && showPrecip) {
        // Cool blue for high precipitation / water availability
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x0066ff).multiplyScalar(0.2));
    }
    if (tempTexture && showTemp) {
        // Hot tint for higher temperatures (climate stress) - amplified by sim
        let warmIntensity = 0.25 + simWarm * 0.6;
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0xff4400).multiplyScalar(warmIntensity));
    }
    if (plantedForestsTexture && (showPlanted || currentEELayer === 'planted')) {
        // Special tint for planted forests (e.g. managed/plantation color, often different from natural)
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x3a8f3a).multiplyScalar(0.25));  // distinct green for plantations
    }
    if (treeGainTexture && showTreeGain) {
        // Bright green for tree cover gain (positive regeneration / restoration)
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x00ff7f).multiplyScalar(0.35));
    }
    if (forestExtentTexture && showForestExtent) {
        // Darker green / forest green for remaining tree cover extent (baseline forest)
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x228b22).multiplyScalar(0.3));
    }
    if (alertsTexture && showAlerts) {
        // Hot red/orange for recent deforestation alerts (GLAD near-real-time alerts)
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0xff0000).multiplyScalar(0.4 + simDeforest * 0.3));
    }
    if (soilCarbonTexture && (currentEELayer === 'soilcarbon' || document.getElementById('show-soilcarbon')?.checked)) {
        // Brown/earth tones for soil carbon
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x8b4513).multiplyScalar(0.2));
    }
    if (biomassTexture && (currentEELayer === 'biomass' || document.getElementById('show-biomass')?.checked)) {
        // Deep green for biomass
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x006400).multiplyScalar(0.25));
    }
    if (biodiversityTexture && (currentEELayer === 'biodiversity' || document.getElementById('show-biodiversity')?.checked)) {
        // Vibrant for biodiversity
        emissiveColor = emissiveColor.clone().add(new THREE.Color(0x9932cc).multiplyScalar(0.2));
    }

    mat.emissive = emissiveColor;
    mat.needsUpdate = true;
}

function updateAnalysisStats() {
    const netEl = document.getElementById('net-change');
    const alertEl = document.getElementById('alert-level');
    const healthEl = document.getElementById('forest-health');
    if (!netEl || !alertEl || !healthEl) return;

    // Simple demo calculations based on active layers and sims (inspired by GFW map analysis)
    let net = 0;
    if (forestLossTexture && (showLandCover || currentEELayer === 'forestloss')) net -= 12 + simDeforest * 18;
    if (treeGainTexture && showTreeGain) net += 5 + (1 - simWarm) * 4;
    if (forestExtentTexture && showForestExtent) net += 3;
    if (alertsTexture && showAlerts) net -= 5 + simDeforest * 8;  // alerts indicate ongoing loss

    const netStr = (net > 0 ? '+' : '') + net.toFixed(0) + '%';
    netEl.textContent = netStr;
    netEl.style.color = net > 0 ? '#22c55e' : '#ef4444';

    let alertLevel = 'Low';
    if (alertsTexture && showAlerts) {
        const intensity = 0.4 + simDeforest * 0.5;
        alertLevel = intensity > 0.7 ? 'Very High' : (intensity > 0.4 ? 'High' : 'Moderate');
    }
    alertEl.textContent = alertLevel;
    alertEl.style.color = alertLevel.includes('High') ? '#ef4444' : '#f59e0b';

    let health = 65 + (net / 2) - simWarm * 20 - simDeforest * 15;
    health = Math.max(20, Math.min(95, Math.round(health)));
    healthEl.textContent = health + '/100';
    healthEl.style.color = health > 70 ? '#22c55e' : (health > 45 ? '#eab308' : '#ef4444');
}

function onCanvasClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(globe, true);

    if (intersects.length > 0) {
        const point = intersects[0].point.clone();

        // Adjust for current globe rotation to get accurate geographic coordinates
        const rotY = -globe.rotation.y;
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const adjX = point.x * cosY - point.z * sinY;
        const adjZ = point.x * sinY + point.z * cosY;

        const lat = Math.asin(point.y / 60) * (180 / Math.PI);
        let lon = Math.atan2(adjZ, adjX) * (180 / Math.PI);
        // Normalize lon to -180..180
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;

        // Visual marker on globe
        if (clickMarker) {
            scene.remove(clickMarker);
        }
        const markerGeo = new THREE.SphereGeometry(1.8, 12, 12);
        const markerMat = new THREE.MeshBasicMaterial({
            color: 0x22c55e,
            transparent: true,
            opacity: 0.85
        });
        clickMarker = new THREE.Mesh(markerGeo, markerMat);
        clickMarker.position.copy(point);
        scene.add(clickMarker);

        // Show sustainability info
        showLocationInfo(lat, lon);
    }
}

function showLocationInfo(lat, lon) {
    const inspector = document.getElementById('location-inspector');
    const coordsEl = document.getElementById('coords');
    const biomeEl = document.getElementById('biome-info');
    const metricsEl = document.getElementById('sustainability-metrics');
    const actionEl = document.getElementById('action-suggestion');

    if (!inspector || !coordsEl) return;

    inspector.style.display = 'block';

    coordsEl.innerHTML = `<strong>Lat:</strong> ${lat.toFixed(1)}° &nbsp; <strong>Lon:</strong> ${lon.toFixed(1)}°`;

    // Determine biome and sustainability data based on location + current app state
    let biomeName = "Mixed / Transition Zone";
    if (Math.abs(lat) > 66) biomeName = "Tundra & Polar";
    else if (Math.abs(lat) > 50) biomeName = "Boreal / Taiga Forest";
    else if (Math.abs(lat) < 15) biomeName = "Tropical Rainforest";
    else if (Math.abs(lat) < 30) biomeName = "Tropical Savanna / Dry Forest";
    else biomeName = "Temperate Forest & Grassland";

    if (showAlerts && alertsTexture) biomeName += " (Active Deforestation Alerts)";

    if (showPlanted && plantedForestsTexture && Math.abs(lat) < 20) {
        biomeName = "Planted / Managed Forest Area";
    }

    biomeEl.innerHTML = `<strong>Biome:</strong> ${biomeName}`;

    // Sustainability metrics (demo, driven by layers + sims + location)
    const seasonBoost = Math.sin(((currentSeason || 6) - 3) * Math.PI / 6) * 0.25;
    const baseHealth = Math.max(25, Math.min(95, 70 + (vegetationGlow - 0.5) * 40 + seasonBoost * 30));
    const risk = Math.max(5, Math.min(95, Math.round(simDeforest * 55 + simWarm * 35 - vegetationGlow * 20)));
    const carbon = Math.round((baseHealth / 100) * 180 + (showForestExtent ? 40 : 0));

    metricsEl.innerHTML = `
        <strong>Vegetation Health:</strong> ${baseHealth.toFixed(0)}%<br>
        <strong>Deforestation Risk:</strong> ${risk}%<br>
        <strong>Est. Carbon Stock:</strong> ~${carbon} tC/ha
    `;

    // Actionable sustainability suggestion
    let suggestion = "This location shows balanced conditions. Support local conservation efforts.";
    if (risk > 65) {
        suggestion = "High risk area. Prioritize protection and restoration to align with SDG 13 & 15.";
    } else if (baseHealth > 80 && showTreeGain) {
        suggestion = "Strong recovery zone. Excellent candidate for carbon credit / biodiversity projects.";
    } else if (showAlerts) {
        suggestion = "Recent alerts detected. Monitor via GFW alerts and engage community monitoring.";
    }

    actionEl.textContent = suggestion;
}

// Bump map for terrain relief (mountains, valleys)
const bumpUrls = [
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_bump_2048x1024.jpg'
];

function loadBumpTexture(index = 0) {
    if (index >= bumpUrls.length) return;
    textureLoader.load(
        bumpUrls[index],
        function (texture) {
            bumpTexture = configureTexture(texture);
            applyEarthMaterial();
        },
        undefined,
        function () {
            loadBumpTexture(index + 1);
        }
    );
}

// Specular map → converted to roughness for shiny oceans vs matte land
const specularUrls = [
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_specular_2048x1024.jpg'
];

function loadSpecularTexture(index = 0) {
    if (index >= specularUrls.length) return;
    textureLoader.load(
        specularUrls[index],
        function (texture) {
            specularTexture = configureTexture(texture);
            applyEarthMaterial();
        },
        undefined,
        function () {
            loadSpecularTexture(index + 1);
        }
    );
}

// Start loading bump, specular + all seasonal vegetation textures
loadBumpTexture();
loadSpecularTexture();
preloadMonthlyTextures();

// --- Earth Engine / GFW Catalog Dataset Layers (Building Data-Rich Sustainability Platform) ---
// Keep expanding this section with more datasets about Earth's natural environment.
// Goal: rich multi-layer data for simulations (deforestation, climate impacts, biodiversity, etc.).

// How to get more:
// 1. https://developers.google.com/earth-engine/datasets/catalog
// 2. https://data.globalforestwatch.org
// 3. Export global equirect maps (EPSG:4326, ~2k-4k res)
// 4. Update the *Urls arrays below + add logic in applyEarthMaterial / applyEmissiveToMaterial

const ndviUrls = [
    // Replace with exported MOD13 NDVI
    'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/july/world.topo.200407.3x5400x2700.jpg'
];
function loadNDVITexture(index = 0) {
    if (index >= ndviUrls.length) return;
    textureLoader.load(ndviUrls[index], function(tex) {
        ndviTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadNDVITexture(index+1));
}

const treeCoverUrls = [
    // Replace with exported MOD44B Percent_Tree_Cover
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadTreeCoverTexture(index = 0) {
    if (index >= treeCoverUrls.length) return;
    textureLoader.load(treeCoverUrls[index], function(tex) {
        treeCoverTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadTreeCoverTexture(index+1));
}

const landCoverUrls = [
    // Replace with exported MCD12Q1 LC_Type1
    'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/july/world.topo.200407.3x5400x2700.jpg'
];
function loadLandCoverTexture(index = 0) {
    if (index >= landCoverUrls.length) return;
    textureLoader.load(landCoverUrls[index], function(tex) {
        landCoverTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadLandCoverTexture(index+1));
}

const forestLossUrls = [
    // Hansen Global Forest Change
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadForestLossTexture(index = 0) {
    if (index >= forestLossUrls.length) return;
    textureLoader.load(forestLossUrls[index], function(tex) {
        forestLossTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadForestLossTexture(index+1));
}

const nightLightsUrls = [
    // Nighttime Lights
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadNightLightsTexture(index = 0) {
    if (index >= nightLightsUrls.length) return;
    textureLoader.load(nightLightsUrls[index], function(tex) {
        nightLightsTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadNightLightsTexture(index+1));
}

const precipUrls = [
    // CHIRPS Precipitation
    'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/july/world.topo.200407.3x5400x2700.jpg'
];
function loadPrecipTexture(index = 0) {
    if (index >= precipUrls.length) return;
    textureLoader.load(precipUrls[index], function(tex) {
        precipTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadPrecipTexture(index+1));
}

const tempUrls = [
    // MODIS LST
    'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/july/world.topo.200407.3x5400x2700.jpg'
];
function loadTempTexture(index = 0) {
    if (index >= tempUrls.length) return;
    textureLoader.load(tempUrls[index], function(tex) {
        tempTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadTempTexture(index+1));
}

const plantedForestsUrls = [
    // GFW Planted Forests (SDPT) - rasterized
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadPlantedForestsTexture(index = 0) {
    if (index >= plantedForestsUrls.length) return;
    textureLoader.load(plantedForestsUrls[index], function(tex) {
        plantedForestsTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadPlantedForestsTexture(index+1));
}

const treeGainUrls = [
    // GFW Tree Cover Gain
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadTreeGainTexture(index = 0) {
    if (index >= treeGainUrls.length) return;
    textureLoader.load(treeGainUrls[index], function(tex) {
        treeGainTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadTreeGainTexture(index+1));
}

const forestExtentUrls = [
    // GFW Tree Cover Extent
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadForestExtentTexture(index = 0) {
    if (index >= forestExtentUrls.length) return;
    textureLoader.load(forestExtentUrls[index], function(tex) {
        forestExtentTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadForestExtentTexture(index+1));
}

const alertsUrls = [
    // GFW Deforestation Alerts (aggregated)
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadAlertsTexture(index = 0) {
    if (index >= alertsUrls.length) return;
    textureLoader.load(alertsUrls[index], function(tex) {
        alertsTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadAlertsTexture(index+1));
}

// NEW: More data layers about Earth's natural environment
const soilCarbonUrls = [
    // Soil Organic Carbon (e.g. from SoilGrids or similar via EE)
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadSoilCarbonTexture(index = 0) {
    if (index >= soilCarbonUrls.length) return;
    textureLoader.load(soilCarbonUrls[index], function(tex) {
        soilCarbonTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadSoilCarbonTexture(index+1));
}

const biomassUrls = [
    // Above Ground Biomass / Carbon Stock
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadBiomassTexture(index = 0) {
    if (index >= biomassUrls.length) return;
    textureLoader.load(biomassUrls[index], function(tex) {
        biomassTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadBiomassTexture(index+1));
}

const biodiversityUrls = [
    // Biodiversity Intactness Index or similar
    'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg'
];
function loadBiodiversityTexture(index = 0) {
    if (index >= biodiversityUrls.length) return;
    textureLoader.load(biodiversityUrls[index], function(tex) {
        biodiversityTexture = configureTexture(tex);
        applyEarthMaterial();
    }, undefined, () => loadBiodiversityTexture(index+1));
}

loadNDVITexture();
loadTreeCoverTexture();
loadLandCoverTexture();
loadForestLossTexture();
loadNightLightsTexture();
loadPrecipTexture();
loadTempTexture();
loadPlantedForestsTexture();
loadTreeGainTexture();
loadForestExtentTexture();
loadAlertsTexture();
loadSoilCarbonTexture();
loadBiomassTexture();
loadBiodiversityTexture();

// Re-apply after layers
setTimeout(() => { if (typeof applyEarthMaterial === 'function') applyEarthMaterial(); }, 300);

// === Vision: Environmental Sustainability Simulation Platform ===
// ... (keep the vision comment if desired, omitted for brevity)

// --- 6. ANIMATION LOOP ---
let clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();

    // Subtle rotation adjustments over time if not handled directly by user drag
    if (controls.state === -1) {
        globe.rotation.y += 0.0005;
    }

    // Keep transition sphere perfectly synced during seasonal crossfade
    if (transitionSphere && transitionSphere.visible) {
        transitionSphere.rotation.copy(globe.rotation);
    }

    // Twinkle stars effect by adjusting opacity based on a sine wave
    starMaterial.opacity = 0.6 + Math.sin(elapsedTime * 2) * 0.2;

    controls.update();
    renderer.render(scene, camera);
}

// --- 7. HANDLE WINDOW RESIZE ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Enable globe clicking for sustainability inspection
renderer.domElement.addEventListener('click', onCanvasClick);

// --- SEASONAL VEGETATION UI WIRING ---
// Hook up the controls after elements exist
setTimeout(() => {
    const slider = document.getElementById('season-slider');
    const playBtn = document.getElementById('season-play');
    const resetBtn = document.getElementById('season-reset');

    if (slider) {
        slider.addEventListener('input', (e) => {
            if (isSeasonPlaying) {
                // Stop autoplay when user takes manual control
                const btn = document.getElementById('season-play');
                isSeasonPlaying = false;
                if (btn) {
                    btn.textContent = '▶ Play Seasons';
                    btn.style.background = 'rgba(163, 230, 53, 0.15)';
                }
                if (seasonPlayInterval) {
                    clearInterval(seasonPlayInterval);
                    seasonPlayInterval = null;
                }
            }
            setSeason(parseInt(e.target.value), 650);
        });
    }

    if (playBtn) {
        playBtn.addEventListener('click', toggleSeasonPlay);
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', resetSeason);
    }

    // #2 Vegetation Glow slider
    const vegSlider = document.getElementById('veg-glow');
    if (vegSlider) {
        vegSlider.value = vegetationGlow;
        vegSlider.addEventListener('input', (e) => {
            updateVegetationGlow(parseFloat(e.target.value));
        });
    }

    // EE Data Layers integration
    const eeLayerSelect = document.getElementById('ee-layer');
    const landcoverCheck = document.getElementById('show-landcover');
    if (eeLayerSelect) {
        eeLayerSelect.value = currentEELayer;
        eeLayerSelect.addEventListener('change', () => {
            currentEELayer = eeLayerSelect.value;
            applyEarthMaterial();
        });
    }
    if (landcoverCheck) {
        landcoverCheck.checked = showLandCover;
        landcoverCheck.addEventListener('change', () => {
            showLandCover = landcoverCheck.checked;
            applyEarthMaterial();
        });
    }

    const precipCheck = document.getElementById('show-precip');
    if (precipCheck) {
        precipCheck.checked = showPrecip;
        precipCheck.addEventListener('change', () => {
            showPrecip = precipCheck.checked;
            applyEarthMaterial();
        });
    }

    const tempCheck = document.getElementById('show-temp');
    if (tempCheck) {
        tempCheck.checked = showTemp;
        tempCheck.addEventListener('change', () => {
            showTemp = tempCheck.checked;
            applyEarthMaterial();
        });
    }

    const plantedCheck = document.getElementById('show-planted');
    if (plantedCheck) {
        plantedCheck.checked = showPlanted;
        plantedCheck.addEventListener('change', () => {
            showPlanted = plantedCheck.checked;
            applyEarthMaterial();
        });
    }

    const treeGainCheck = document.getElementById('show-treegain');
    if (treeGainCheck) {
        treeGainCheck.checked = showTreeGain;
        treeGainCheck.addEventListener('change', () => {
            showTreeGain = treeGainCheck.checked;
            applyEarthMaterial();
        });
    }

    const forestExtentCheck = document.getElementById('show-forestextent');
    if (forestExtentCheck) {
        forestExtentCheck.checked = showForestExtent;
        forestExtentCheck.addEventListener('change', () => {
            showForestExtent = forestExtentCheck.checked;
            applyEarthMaterial();
        });
    }

    const alertsCheck = document.getElementById('show-alerts');
    if (alertsCheck) {
        alertsCheck.checked = showAlerts;
        alertsCheck.addEventListener('change', () => {
            showAlerts = alertsCheck.checked;
            applyEarthMaterial();
        });
    }

    // New natural environment checkboxes
    const soilCheck = document.getElementById('show-soilcarbon');
    if (soilCheck) {
        soilCheck.checked = !!document.getElementById('show-soilcarbon')?.checked;
        soilCheck.addEventListener('change', () => {
            applyEarthMaterial();
        });
    }

    const biomassCheck = document.getElementById('show-biomass');
    if (biomassCheck) {
        biomassCheck.checked = !!document.getElementById('show-biomass')?.checked;
        biomassCheck.addEventListener('change', () => {
            applyEarthMaterial();
        });
    }

    const bioCheck = document.getElementById('show-biodiversity');
    if (bioCheck) {
        bioCheck.checked = !!document.getElementById('show-biodiversity')?.checked;
        bioCheck.addEventListener('change', () => {
            applyEarthMaterial();
        });
    }

    // Set initial values for toggles
    if (precipCheck) precipCheck.checked = showPrecip;
    if (tempCheck) tempCheck.checked = showTemp;
    if (plantedCheck) plantedCheck.checked = showPlanted;
    if (treeGainCheck) treeGainCheck.checked = showTreeGain;
    if (forestExtentCheck) forestExtentCheck.checked = showForestExtent;
    if (alertsCheck) alertsCheck.checked = showAlerts;

    // Sustainability simulation sliders
    const deforestSlider = document.getElementById('sim-deforest');
    const warmSlider = document.getElementById('sim-warm');
    if (deforestSlider) {
        deforestSlider.value = simDeforest;
        deforestSlider.addEventListener('input', (e) => {
            simDeforest = parseFloat(e.target.value);
            applyEarthMaterial();
        });
    }
    if (warmSlider) {
        warmSlider.value = simWarm;
        warmSlider.addEventListener('input', (e) => {
            simWarm = parseFloat(e.target.value);
            applyEarthMaterial();
        });
    }

    // Set initial UI label
    updateSeasonUI();
}, 150);

// Initialize execution loop
animate();