/***********************************************************
  pbr.js
  - Persistent texture definitions
  - Active‐texture tracking
  - Multiple scene objects, live updates on texture change
  - Thicker create-texture border
  - Placeholder uses current texture fill
  - Popover for settings button
  - Click object to select its texture
  - Ruler marks and print box behind all objects
  - Image import popover for color & numeric fields
  - SVG background set to rgb(249,249,240)
  - + Gray‐out labels when inputs are disabled
  - + Hide subordinate rows whenever weight === 0
************************************************************/

// ------------------------
// Global Data Structures
// ------------------------

let textures = [];
let currentTextureIndex = null;
let inCreateTextureContext = false;
let hiddenShapes = [];
let createTextureShape = null;
let textureCount = 0;

let sceneObjects = [];

let prefsPopover = null;
let imgImportPopover = null;
let imgImportField = null;

let selectedObjectTextureIndex = null;
// remember which shape to restore after child-texture edit
let _restoreSelectedShape = null;

function setEditorEnabled(enabled) {
    // all form controls under #palette.content (inputs, thumb-buttons, drag handles)
    document.querySelectorAll('#palette .content input, #palette .content button, #palette .content .drag-handle')
        .forEach(el => {
            // skip the toggle button in header
            if (el.closest('.header')) return;
            el.disabled = !enabled;
            el.style.opacity = enabled ? '' : '0.5';
            // grey out its label too
            const row = el.closest('.row');
            if (row) {
                const lbl = row.querySelector('label');
                if (lbl) lbl.style.color = enabled ? '' : '#888';
            }
        });
}
// ----------------------------------------------
// Utility: Convert hex color → {r,g,b}
// ----------------------------------------------
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const intVal = parseInt(hex, 16);
    return {
        r: (intVal >> 16) & 0xFF,
        g: (intVal >> 8) & 0xFF,
        b: (intVal >> 0) & 0xFF
    };
}

// ----------------------------------------------
// Utility: Convert {r,g,b} → "#RRGGBB"
// ----------------------------------------------
function rgbToHex(r, g, b) {
    function to2digit(n) {
        const s = Math.round(n).toString(16);
        return s.length < 2 ? '0' + s : s;
    }
    return '#' + to2digit(r) + to2digit(g) + to2digit(b);
}

// --------------------------------------------------------------
// Update thumbnail of texture #idx in left palette
// --------------------------------------------------------------
function updateTextureThumbnail(idx) {
    const def = textures[idx];
    const itemDiv = document.querySelector(`.texture-item[data-texture-index="${idx}"]`);
    if (!itemDiv) return;
    const thumbDiv = itemDiv.querySelector('.texture-thumb');

    const bw = def.baseWeight / 100;
    const sw = def.specWeight / 100;
    const tw = def.transWeight / 100;
    const bc = hexToRgb(def.baseColor);
    const sc = hexToRgb(def.specColor);
    const tc = hexToRgb(def.transColor);

    let r = bw * bc.r + sw * sc.r + tw * tc.r;
    let g = bw * bc.g + sw * sc.g + tw * tc.g;
    let b = bw * bc.b + sw * sc.b + tw * tc.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));
    const fillHex = rgbToHex(r, g, b);

    thumbDiv.style.backgroundImage = '';
    thumbDiv.style.backgroundColor = fillHex;
}

// ------------------------------------------------------------------------
// Load texture #idx into the "Edit Texture" palette (right side)
// ------------------------------------------------------------------------
// helper: set thumb-button background from a UseImage flag + dataURL
function applyThumb(thumbEl, useImage, imgDataUrl) {
    if (!thumbEl) return;
    if (useImage && imgDataUrl) {
        thumbEl.style.backgroundImage = `url(${imgDataUrl})`;
        thumbEl.style.backgroundSize = 'cover';
        thumbEl.style.backgroundColor = 'transparent';
    } else {
        thumbEl.style.backgroundImage = '';
        thumbEl.style.backgroundColor = '#ccc';
    }
}

// helper: load a field + optional thumbnail
function loadField(id, def, opts = { noThumb: false }) {
    const el = document.getElementById(id);
    if (!el) return;
    // set value / checked
    if (el.type === 'checkbox') {
        el.checked = !!def.value;
    } else {
        el.value = def.value;
        el.disabled = !!def.useImage;
        grayOutLabelAndHandle(el, def.useImage);
    }
    // thumbnail?
    if (!opts.noThumb) {
        const thumb = el.closest('.row')?.querySelector('.thumb-button');
        applyThumb(thumb, def.useImage, def.imgDataUrl);
    }
}

function loadTextureIntoEditor(idx) {
    // 1) enable & un-gray all inputs
    document.querySelectorAll('#palette .content input')
        .forEach(el => {
            el.disabled = false;
            el.style.opacity = '';
            const lbl = el.closest('.row')?.querySelector('label');
            if (lbl) lbl.style.color = '';
        });

    // 2) no-selection → reset everything
    if (idx == null) {
        document.querySelectorAll('#palette .content input, #palette .content .thumb-button')
            .forEach(el => {
                if (el.tagName === 'INPUT' && el.type === 'color') el.value = '#777777';
                if (el.tagName === 'INPUT' && el.type === 'number') el.value = 0;
                if (el.classList.contains('thumb-button')) {
                    el.style.backgroundImage = '';
                    el.style.backgroundColor = '#ccc';
                }
            });
        toggleBaseRows(); toggleSpecRows(); toggleTransRows();
        return;
    }

    const def = textures[idx];
    if (!def) return;

    // 3) weights (no thumbs)
    ['base-weight', 'spec-weight', 'trans-weight',
        'subsurface-weight', 'coat-weight', 'fuzz-weight',
        'emission-weight', 'thin-film-weight', 'geometry-weight'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = def[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    });

    // 4) all “value+thumb” fields
    const fields = [
        // id                 , defKey            , useKey                 , imgKey
        ['base-color', 'baseColor', 'baseColorUseImage', 'baseColorImgDataUrl'],
        ['spec-color', 'specColor', 'specColorUseImage', 'specColorImgDataUrl'],
        ['trans-color', 'transColor', 'transColorUseImage', 'transColorImgDataUrl'],

        ['metalness', 'metalness', 'metalnessUseImage', 'metalnessImgDataUrl'],
        ['diffuse-roughness', 'diffuseRoughness', 'diffuseRoughnessUseImage', 'diffuseRoughnessImgDataUrl'],
        ['spec-roughness', 'specRoughness', 'specRoughnessUseImage', 'specRoughnessImgDataUrl'],
        ['roughness-anisotropy', 'roughnessAnisotropy', 'roughnessAnisotropyUseImage', 'roughnessAnisotropyImgDataUrl'],
        ['ior', 'ior', 'iorUseImage', 'iorImgDataUrl'],
        ['depth', 'depth', 'depthUseImage', 'depthImgDataUrl'],
        ['scatter', 'scatter', 'scatterUseImage', 'scatterImgDataUrl'],
        ['scatter-anisotropy', 'scatterAnisotropy', 'scatterAnisotropyUseImage', 'scatterAnisotropyImgDataUrl'],
        ['dispersion-scale', 'dispersionScale', 'dispersionScaleUseImage', 'dispersionScaleImgDataUrl'],
        ['abbe', 'abbe', 'abbeUseImage', 'abbeImgDataUrl'],

        ['subsurface-color', 'subsurfaceColor', 'subsurfaceColorUseImage', 'subsurfaceColorImgDataUrl'],
        ['subsurface-radius', 'subsurfaceRadius', 'subsurfaceRadiusUseImage', 'subsurfaceRadiusImgDataUrl'],
        ['subsurface-radius-scale', 'subsurfaceRadiusScale', 'subsurfaceRadiusScaleUseImage', 'subsurfaceRadiusScaleImgDataUrl'],
        ['subsurface-scatter-anisotropy', 'subsurfaceScatterAnisotropy', 'subsurfaceScatterAnisotropyUseImage', 'subsurfaceScatterAnisotropyImgDataUrl'],

        ['coat-color', 'coatColor', 'coatColorUseImage', 'coatColorImgDataUrl'],
        ['coat-roughness', 'coatRoughness', 'coatRoughnessUseImage', 'coatRoughnessImgDataUrl'],
        ['coat-roughness-anisotropy', 'coatRoughnessAnisotropy', 'coatRoughnessAnisotropyUseImage', 'coatRoughnessAnisotropyImgDataUrl'],
        ['coat-ior', 'coatIor', 'coatIorUseImage', 'coatIorImgDataUrl'],
        ['coat-darkening', 'coatDarkening', 'coatDarkeningUseImage', 'coatDarkeningImgDataUrl'],

        ['fuzz-color', 'fuzzColor', 'fuzzColorUseImage', 'fuzzColorImgDataUrl'],
        ['fuzz-roughness', 'fuzzRoughness', 'fuzzRoughnessUseImage', 'fuzzRoughnessImgDataUrl'],

        ['emission-color', 'emissionColor', 'emissionColorUseImage', 'emissionColorImgDataUrl'],

        ['thin-film-thickness', 'thinFilmThickness', 'thinFilmThicknessUseImage', 'thinFilmThicknessImgDataUrl'],
        ['thin-film-ior', 'thinFilmIor', 'thinFilmIorUseImage', 'thinFilmIorImgDataUrl'],

        ['geometry-thin-walled', 'geometryThinWalled', /*checkbox*/, /*no thumb*/],
        ['geometry-normal', 'geometryNormal', 'geometryNormalUseImage', 'geometryNormalImgDataUrl'],
        ['geometry-tangent', 'geometryTangent', 'geometryTangentUseImage', 'geometryTangentImgDataUrl'],
        ['geometry-coat-normal', 'geometryCoatNormal', 'geometryCoatNormalUseImage', 'geometryCoatNormalImgDataUrl'],
        ['geometry-coat-tangent', 'geometryCoatTangent', 'geometryCoatTangentUseImage', 'geometryCoatTangentImgDataUrl'],
    ];

    fields.forEach(([id, key, useKey, imgKey]) => {
        loadField(id, {
            value: def[key],
            useImage: def[useKey],
            imgDataUrl: def[imgKey]
        }, {
            noThumb: id === 'geometry-thin-walled'
        });
    });

    // → textureSize field
    const sizeEl = document.getElementById('texture-size');
    sizeEl.value = def.textureSize || '';
    sizeEl.disabled = false;  // always editable
    grayOutLabelAndHandle(sizeEl, false);

    // 5) re-hide subordinate rows
    toggleBaseRows();
    toggleSpecRows();
    toggleTransRows();
    toggleSubsurfaceRows();
    toggleCoatRows();
    toggleFuzzRows();
    toggleEmissionRows();
    toggleThinFilmRows();
    toggleGeometryRows();

    // 6) re-gray all disabled inputs & sync popovers
    document.querySelectorAll('#palette .content .row input')
        .forEach(inputEl => grayOutLabelAndHandle(inputEl, inputEl.disabled));
    updateImgImportControls();
}

// ----------------------------------------------------------------------
// Gray‐out the <label> and disable the drag-handle if `disabled===true`.
// ----------------------------------------------------------------------
function grayOutLabelAndHandle(inputEl, disabled) {
    const row = inputEl.closest('.row');
    if (!row) return;
    const label = row.querySelector('label');
    if (label) {
        label.style.color = disabled ? '#888' : '';
    }
    // If there is a drag-handle in this row, disable/gray it
    const dragHandle = row.querySelector('.drag-handle');
    if (dragHandle) {
        if (disabled) {
            dragHandle.style.pointerEvents = 'none';
            dragHandle.style.color = '#aaa';
        } else {
            dragHandle.style.pointerEvents = '';
            dragHandle.style.color = '';
        }
    }
    // Also reduce opacity of the input itself if disabled
    inputEl.style.opacity = disabled ? '0.5' : '';
}

// ----------------------------------------------------------------------
// Mark a texture #idx as active, update right palette, etc.
// ----------------------------------------------------------------------
function selectTexture(idx) {
    if (currentTextureIndex == idx) return;

    if (inCreateTextureContext) {
        exitCreateTextureContext();
    }
    if (currentTextureIndex !== null) {
        const prevItem = document.querySelector(`.texture-item[data-texture-index="${currentTextureIndex}"]`);
        if (prevItem) prevItem.classList.remove('active');
    }
    currentTextureIndex = idx;
    const newItem = document.querySelector(`.texture-item[data-texture-index="${idx}"]`);
    if (newItem) newItem.classList.add('active');
}

// ----------------------------------------------------------------
// Add one texture entry to the left “Textures” palette
// ----------------------------------------------------------------
function addTextureToList(def, idx) {
    const grid = document.getElementById('texture-grid');
    const itemDiv = document.createElement('div');
    itemDiv.className = 'texture-item';
    itemDiv.dataset.textureIndex = idx;
    itemDiv.style.display = 'flex';
    itemDiv.style.flexDirection = 'column';
    itemDiv.style.alignItems = 'center';

    const thumb = document.createElement('div');
    thumb.className = 'texture-thumb';
    thumb.style.width = '80px';
    thumb.style.height = '80px';
    thumb.style.background = '#bbb';
    thumb.style.border = '1px solid #999';
    thumb.style.boxSizing = 'border-box';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'texture-name';
    nameInput.value = def.name;
    nameInput.dataset.textureIndex = idx;
    nameInput.style.marginTop = '4px';
    nameInput.style.width = '80px';
    nameInput.style.boxSizing = 'border-box';
    nameInput.style.textAlign = 'center';
    nameInput.style.fontSize = '12px';
    nameInput.style.padding = '2px';
    nameInput.style.border = '1px solid #999';

    itemDiv.appendChild(thumb);
    itemDiv.appendChild(nameInput);
    grid.appendChild(itemDiv);

    updateTextureThumbnail(idx);
    itemDiv.addEventListener('click', () => selectTexture(idx));
    nameInput.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val.length > 0) {
            textures[idx].name = val;
            if (selectedObjectTextureIndex === idx) {
                updateRenderControl(idx);
            }
        }
        else e.target.value = textures[idx].name;
    });
    nameInput.select();
}

// ----------------------------------------------------------------
// Write right‐palette fields into textures[currentTextureIndex],
// then update thumbnail & all objects using it.
// ----------------------------------------------------------------
function writeInputsIntoSelectedObjectTexture() {
    if (selectedObjectTextureIndex === null) return;
    const def = textures[selectedObjectTextureIndex];

    // — base & spec & trans (unchanged) —
    def.baseWeight = parseFloat(document.getElementById('base-weight').value) || 0;
    def.baseColor = document.getElementById('base-color').value || '#000000';
    def.specWeight = parseFloat(document.getElementById('spec-weight').value) || 0;
    def.specColor = document.getElementById('spec-color').value || '#000000';
    def.transWeight = parseFloat(document.getElementById('trans-weight').value) || 0;
    def.transColor = document.getElementById('trans-color').value || '#000000';

    // If user picked a new file in “base-image-file,” read it (unchanged)
    const baseImgInput = document.getElementById('base-image-file');
    if (baseImgInput && baseImgInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = function (ev) {
            def.baseColorUseImage = true;
            def.baseColorImgDataUrl = ev.target.result;
            updateTextureThumbnail(currentTextureIndex);
            updateAllObjectsForTexture(currentTextureIndex);
            loadTextureIntoEditor(currentTextureIndex);
            updateImgImportControls();
        };
        reader.readAsDataURL(baseImgInput.files[0]);
    }
    
    // — NEW: metalness field —
    const metalEl = document.getElementById('metalness');
    if (metalEl) def.metalness = parseFloat(metalEl.value) || 0;
    def.metalnessUseImage = def.metalnessUseImage || false;

    // — NEW: roughness field —
    const roughEl = document.getElementById('diffuse-roughness');
    if (roughEl) def.diffuseRoughness = parseFloat(roughEl.value) || 0;
    def.diffuseRoughnessUseImage = def.diffuseRoughnessUseImage || false;

    // — NEW: roughness field —
    const specRoughEl = document.getElementById('spec-roughness');
    if (specRoughEl) def.specRoughness = parseFloat(specRoughEl.value) || 0;
    def.specRoughnessUseImage = def.specRoughnessUseImage || false;

    // — NEW: roughness-anisotropy field —
    const roughAniEl = document.getElementById('roughness-anisotropy');
    if (roughAniEl) def.roughnessAnisotropy = parseFloat(roughAniEl.value) || 0;
    def.roughnessAnisotropyUseImage = def.roughnessAnisotropyUseImage || false;

    // — NEW: ior field —
    const iorEl = document.getElementById('ior');
    if (iorEl) def.ior = parseFloat(iorEl.value) || 1.5;
    def.iorUseImage = def.iorUseImage || false;

    // — NEW: depth field —
    const depthEl = document.getElementById('depth');
    if (depthEl) def.depth = parseFloat(depthEl.value) || 0;
    def.depthUseImage = def.depthUseImage || false;

    // — NEW: scatter field —
    const scatterEl = document.getElementById('scatter');
    if (scatterEl) def.scatter = parseFloat(scatterEl.value) || 0;
    def.scatterUseImage = def.scatterUseImage || false;

    // — NEW: scatter-anisotropy field —
    const scatterAniEl = document.getElementById('scatter-anisotropy');
    if (scatterAniEl) def.scatterAnisotropy = parseFloat(scatterAniEl.value) || 0;
    def.scatterAnisotropyUseImage = def.scatterAnisotropyUseImage || false;

    // — NEW: dispersion-scale field —
    const dispEl = document.getElementById('dispersion-scale');
    if (dispEl) def.dispersionScale = parseFloat(dispEl.value) || 0;
    def.dispersionScaleUseImage = def.dispersionScaleUseImage || false;

    // — NEW: abbe field —
    const abbeEl = document.getElementById('abbe');
    if (abbeEl) def.abbe = parseFloat(abbeEl.value) || 0;
    def.abbeUseImage = def.abbeUseImage || false;

    def.subsurfaceWeight = parseFloat(document.getElementById('subsurface-weight').value) || 0;
    def.subsurfaceColor = document.getElementById('subsurface-color').value;
    def.subsurfaceColorUseImage = def.subsurfaceColorUseImage || false;
    def.subsurfaceRadius = document.getElementById('subsurface-radius').value;
    def.subsurfaceRadiusUseImage = def.subsurfaceRadiusUseImage || false;
    def.subsurfaceRadiusScale = document.getElementById('subsurface-radius-scale').value;
    def.subsurfaceRadiusScaleUseImage = def.subsurfaceRadiusScaleUseImage || false;
    def.subsurfaceScatterAnisotropy = document.getElementById('subsurface-scatter-anisotropy').value;
    def.subsurfaceScatterAnisotropyUseImage = def.subsurfaceScatterAnisotropyUseImage || false;

    def.coatWeight = parseFloat(document.getElementById('coat-weight').value) || 0;
    def.coatColor = document.getElementById('coat-color').value;
    def.coatColorUseImage = def.coatColorUseImage || false;
    def.coatRoughness = document.getElementById('coat-roughness').value;
    def.coatRoughnessUseImage = def.coatRoughnessUseImage || false;
    def.coatRoughnessAnisotropy = document.getElementById('coat-roughness-anisotropy').value;
    def.coatRoughnessAnisotropyUseImage = def.coatRoughnessAnisotropyUseImage || false;
    def.coatIor = document.getElementById('coat-ior').value;
    def.coatIorUseImage = def.coatIorUseImage || false;
    def.coatDarkening = document.getElementById('coat-darkening').value;
    def.coatDarkeningUseImage = def.coatDarkeningUseImage || false;

    def.fuzzWeight = parseFloat(document.getElementById('fuzz-weight').value) || 0;
    def.fuzzColor = document.getElementById('fuzz-color').value;
    def.fuzzColorUseImage = def.fuzzColorUseImage || false;
    def.fuzzRoughness = document.getElementById('fuzz-roughness').value;
    def.fuzzRoughnessUseImage = def.fuzzRoughnessUseImage || false;

    def.emissionWeight = parseFloat(document.getElementById('emission-weight').value) || 0;
    def.emissionColor = document.getElementById('emission-color').value;
    def.emissionColorUseImage = def.emissionColorUseImage || false;

    def.thinFilmWeight = parseFloat(document.getElementById('thin-film-weight').value) || 0;
    def.thinFilmThickness = document.getElementById('thin-film-thickness').value;
    def.thinFilmThicknessUseImage = def.thinFilmThicknessUseImage || false;
    def.thinFilmIor = document.getElementById('thin-film-ior').value;
    def.thinFilmIorUseImage = def.thinFilmIorUseImage || false;

    def.geometryWeight = parseFloat(document.getElementById('geometry-weight').value) || 0;
    def.geometryThinWalled = document.getElementById('geometry-thin-walled').checked;
    def.geometryNormal = document.getElementById('geometry-normal').value;
    def.geometryNormalUseImage = def.geometryNormalUseImage || false;
    def.geometryTangent = document.getElementById('geometry-tangent').value;
    def.geometryTangentUseImage = def.geometryTangentUseImage || false;
    def.geometryCoatNormal = document.getElementById('geometry-coat-normal').value;
    def.geometryCoatNormalUseImage = def.geometryCoatNormalUseImage || false;
    def.geometryCoatTangent = document.getElementById('geometry-coat-tangent').value;
    def.geometryCoatTangentUseImage = def.geometryCoatTangentUseImage || false;

    // — NEW: textureSize field —
    const sizeEl = document.getElementById('texture-size');
    if (sizeEl) {
        def.textureSize = sizeEl.value;
    }

    updateTextureThumbnail(selectedObjectTextureIndex);
    updateAllObjectsForTexture(selectedObjectTextureIndex);
    updateRenderControl(selectedObjectTextureIndex);
    loadTextureIntoEditor(selectedObjectTextureIndex);
    updateImgImportControls();
}

// ----------------------------------------------------------
// Create a new texture
// ----------------------------------------------------------
function createNewTexture() {
    textureCount += 1;
    const defaultName = 'Texture-' + textureCount;

    // Include UseImage flags + ImgDataUrl for every field
    const newDef = {
        id: textureCount,
        name: defaultName,

        baseWeight: 50,
        baseColor: '#ff0000',
        baseColorUseImage: false,
        baseColorImgDataUrl: '',

        specWeight: 0,
        specColor: '#777777',
        specColorUseImage: false,
        specColorImgDataUrl: null,

        transWeight: 0,
        transColor: '#777777',
        transColorUseImage: false,
        transColorImgDataUrl: null,

        metalness: 0,
        metalnessUseImage: false,
        metalnessImgDataUrl: null,

        diffuseRoughness: 0,
        diffuseRoughnessUseImage: false,
        diffuseRoughnessImgDataUrl: null,

        specRoughness: 0,
        specRoughnessUseImage: false,
        specRoughnessImgDataUrl: null,

        roughnessAnisotropy: 0,
        roughnessAnisotropyUseImage: false,
        roughnessAnisotropyImgDataUrl: null,

        ior: 1.5,
        iorUseImage: false,
        iorImgDataUrl: null,

        depth: 0,
        depthUseImage: false,
        depthImgDataUrl: null,

        scatter: 0,
        scatterUseImage: false,
        scatterImgDataUrl: null,

        scatterAnisotropy: 0,
        scatterAnisotropyUseImage: false,
        scatterAnisotropyImgDataUrl: null,

        dispersionScale: 0,
        dispersionScaleUseImage: false,
        dispersionScaleImgDataUrl: null,

        abbe: 0,
        abbeUseImage: false,
        abbeImgDataUrl: null,

        metalnessImg: null,
        diffuseRoughnessImg: null,
        specRoughnessImg: null,
        iorImg: null,
        depthImg: null,
        scatterImg: null,
        dispersionImg: null,
        abbeImg: null,

        subsurfaceWeight: 0,
        subsurfaceColor: '#777777',
        subsurfaceColorUseImage: false,
        subsurfaceColorImgDataUrl: null,
        subsurfaceRadius: 0,
        subsurfaceRadiusUseImage: false,
        subsurfaceRadiusImgDataUrl: null,
        subsurfaceRadiusScale: 0,
        subsurfaceRadiusScaleUseImage: false,
        subsurfaceRadiusScaleImgDataUrl: null,
        subsurfaceScatterAnisotropy: 0,
        subsurfaceScatterAnisotropyUseImage: false,
        subsurfaceScatterAnisotropyImgDataUrl: null,

        coatWeight: 0,
        coatColor: '#777777',
        coatColorUseImage: false,
        coatColorImgDataUrl: null,
        coatRoughness: 0,
        coatRoughnessUseImage: false,
        coatRoughnessImgDataUrl: null,
        coatRoughnessAnisotropy: 0,
        coatRoughnessAnisotropyUseImage: false,
        coatRoughnessAnisotropyImgDataUrl: null,
        coatIor: 1.5,
        coatIorUseImage: false,
        coatIorImgDataUrl: null,
        coatDarkening: 0,
        coatDarkeningUseImage: false,
        coatDarkeningImgDataUrl: null,

        fuzzWeight: 0,
        fuzzColor: '#777777',
        fuzzColorUseImage: false,
        fuzzColorImgDataUrl: null,
        fuzzRoughness: 0,
        fuzzRoughnessUseImage: false,
        fuzzRoughnessImgDataUrl: null,

        emissionWeight: 0,
        emissionColor: '#777777',
        emissionColorUseImage: false,
        emissionColorImgDataUrl: null,

        thinFilmWeight: 0,
        thinFilmThickness: 0,
        thinFilmThicknessUseImage: false,
        thinFilmThicknessImgDataUrl: null,
        thinFilmIor: 0,
        thinFilmIorUseImage: false,
        thinFilmIorImgDataUrl: null,

        geometryWeight: 0,
        geometryThinWalled: 0,
        geometryNormal: 0,
        geometryNormalUseImage: false,
        geometryNormalImgDataUrl: null,
        geometryTangent: 0,
        geometryTangentUseImage: false,
        geometryTangentImgDataUrl: null,
        geometryCoatNormal: 0,
        geometryCoatNormalUseImage: false,
        geometryCoatNormalImgDataUrl: null,
        geometryCoatTangent: 0,
        geometryCoatTangentUseImage: false,
        geometryCoatTangentImgDataUrl: null,

        // right after your other PBR properties…
        textureSize: '1',
        textureSizeUseImage: false,
        textureSizeImgDataUrl: null,

    };

    const newIndex = textures.length;
    textures.push(newDef);
    addTextureToList(newDef, newIndex);
    selectTexture(newIndex);
    enterCreateTextureContext();
}

// ----------------------------------------------
// Enter "create texture" context
// ----------------------------------------------
function enterCreateTextureContext() {
    if (inCreateTextureContext) return;
    inCreateTextureContext = true;

    const svg = document.getElementById('scene');
    if (!svg) return;

    hiddenShapes = [];
    Array.from(svg.children).forEach(child => {
        hiddenShapes.push(child);
        child.style.display = 'none';
    });

    const bbox = svg.getBoundingClientRect();
    const sceneW = bbox.width, sceneH = bbox.height;
    const w = sceneW * 0.6;
    const h = sceneH * 0.6;
    const x = (sceneW - w) / 2;
    const y = (sceneH - h) / 2;
    const rad = 0.1 * Math.min(w, h);

    createTextureShape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    createTextureShape.setAttribute("x", x);
    createTextureShape.setAttribute("y", y);
    createTextureShape.setAttribute("width", w);
    createTextureShape.setAttribute("height", h);
    createTextureShape.setAttribute("rx", rad);
    createTextureShape.setAttribute("ry", rad);

    if (currentTextureIndex !== null) {
        const def = textures[currentTextureIndex];
        const bw = def.baseWeight / 100;
        const sw = def.specWeight / 100;
        const tw = def.transWeight / 100;
        const bc = hexToRgb(def.baseColor);
        const sc = hexToRgb(def.specColor);
        const tc = hexToRgb(def.transColor);

        let r = bw * bc.r + sw * sc.r + tw * tc.r;
        let g = bw * bc.g + sw * sc.g + tw * tc.g;
        let b = bw * bc.b + sw * sc.b + tw * tc.b;
        r = Math.round(Math.min(Math.max(r, 0), 255));
        g = Math.round(Math.min(Math.max(g, 0), 255));
        b = Math.round(Math.min(Math.max(b, 0), 255));
        const fillHex = rgbToHex(r, g, b);
        createTextureShape.setAttribute("fill", fillHex);
    } else {
        createTextureShape.setAttribute("fill", "#ffffff");
    }
    createTextureShape.setAttribute("stroke", "#000000");
    createTextureShape.setAttribute("stroke-width", "1");
    svg.appendChild(createTextureShape);
    // ─── make placeholder act like any other object ───
    sceneObjects.push({
        el: createTextureShape,
        textureIndex: currentTextureIndex
    });

    createTextureShape.style.cursor = 'pointer';
    createTextureShape.addEventListener('click', e => {
        e.stopPropagation();             // don’t let it bubble to the SVG background
        selectShape(createTextureShape); // re‐select it (loads editor + outline)
    });

    
    // clear any prior outline
    if (currentSelectedShape) {
        currentSelectedShape.classList.remove('selected-shape');
        }
    
    createTextureShape.classList.add('selected-shape');
    currentSelectedShape = createTextureShape;
    selectedObjectTextureIndex = currentTextureIndex;
    setEditorEnabled(true);
    loadTextureIntoEditor(selectedObjectTextureIndex);

    // update Render palette to show this new‐texture placeholder
    updateRenderControl(currentTextureIndex);

    document.getElementById('create-texture-border').style.border = '25px solid rgba(255,165,0,0.5)';
    document.getElementById('create-texture-border').style.display = 'block';
    document.getElementById('texture-create-controls').style.display = 'flex';

    document.getElementById('btn-create-object').disabled = true;
}

// ----------------------------------------------
// Exit "create texture" context
// ----------------------------------------------
function exitCreateTextureContext() {
    if (!inCreateTextureContext) return;
    inCreateTextureContext = false;

    const svg = document.getElementById('scene');
    if (!svg) return;

    if (createTextureShape) {
        svg.removeChild(createTextureShape);
        createTextureShape = null;
    }
    hiddenShapes.forEach(child => child.style.display = '');
    hiddenShapes = [];
    document.getElementById('create-texture-border').style.display = 'none';
    document.getElementById('texture-create-controls').style.display = 'none';

    document.getElementById('btn-create-object').disabled = false;
    // ─── Clear any selected shape ───
    if (currentSelectedShape) {
        currentSelectedShape.classList.remove('selected-shape');
    }
    currentSelectedShape = null;
    selectedObjectTextureIndex = null;
    
    // ─── Disable & clear the editor ───
    setEditorEnabled(false);
    loadTextureIntoEditor(null);
    
    // ─── Reset the Render palette ───
    updateRenderControl(null);

    // ─── Restore the previous shape, if we’re coming back from child-texture edit ───
    if (_restoreSelectedShape) {
        selectShape(_restoreSelectedShape);
        _restoreSelectedShape = null;
    }
}

// ---------------------------------------------------------
// Update all SVG objects that use texture #idx
// ---------------------------------------------------------
function updateAllObjectsForTexture(idx) {
    const def = textures[idx];
    if (!def) return;

    const bw = def.baseWeight / 100;
    const sw = def.specWeight / 100;
    const tw = def.transWeight / 100;
    const bc = hexToRgb(def.baseColor);
    const sc = hexToRgb(def.specColor);
    const tc = hexToRgb(def.transColor);

    let r = bw * bc.r + sw * sc.r + tw * tc.r;
    let g = bw * bc.g + sw * sc.g + tw * tc.g;
    let b = bw * bc.b + sw * sc.b + tw * tc.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));
    const fillHex = rgbToHex(r, g, b);

    sceneObjects.forEach(obj => {
        if (obj.textureIndex === idx) {
            obj.el.setAttribute('fill', fillHex);
        }
    });
    if (createTextureShape) {
        createTextureShape.setAttribute("fill", fillHex);
    }
}

// ------------------------------------------------------
// Draw a new SVG object using the current texture
// ------------------------------------------------------
function drawRandomShape() {
    if (inCreateTextureContext) exitCreateTextureContext();

    const svg = document.getElementById('scene');
    if (!svg) {
        console.warn("No #scene element found in DOM.");
        return;
    }
    if (currentTextureIndex === null) {
        alert("Please select or create a texture first.");
        return;
    }

    const def = textures[currentTextureIndex];
    const bw = def.baseWeight / 100;
    const sw = def.specWeight / 100;
    const tw = def.transWeight / 100;
    const bc = hexToRgb(def.baseColor);
    const sc = hexToRgb(def.specColor);
    const tc = hexToRgb(def.transColor);

    let r = bw * bc.r + sw * sc.r + tw * tc.r;
    let g = bw * bc.g + sw * sc.g + tw * tc.g;
    let b = bw * bc.b + sw * sc.b + tw * tc.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));
    const fillHex = rgbToHex(r, g, b);

    const shapeTypes = ['circle', 'rect', 'rounded-rect', 'ellipse'];
    const choice = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
    const bbox = svg.getBoundingClientRect();
    const sceneW = bbox.width, sceneH = bbox.height;
    const minSize = 30, maxSize = 150;
    const w = minSize + Math.random() * (maxSize - minSize);
    const h = minSize + Math.random() * (maxSize - minSize);
    const x = Math.random() * (sceneW - w);
    const y = Math.random() * (sceneH - h);

    let el;
    switch (choice) {
        case 'circle': {
            const r0 = Math.min(w, h) / 2;
            el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            el.setAttribute("cx", x + r0);
            el.setAttribute("cy", y + r0);
            el.setAttribute("r", r0);
            break;
        }
        case 'ellipse': {
            el = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
            el.setAttribute("cx", x + w / 2);
            el.setAttribute("cy", y + h / 2);
            el.setAttribute("rx", w / 2);
            el.setAttribute("ry", h / 2);
            break;
        }
        case 'rect': {
            el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            el.setAttribute("x", x);
            el.setAttribute("y", y);
            el.setAttribute("width", w);
            el.setAttribute("height", h);
            break;
        }
        case 'rounded-rect': {
            const rad = 0.2 * Math.min(w, h);
            el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            el.setAttribute("x", x);
            el.setAttribute("y", y);
            el.setAttribute("width", w);
            el.setAttribute("height", h);
            el.setAttribute("rx", rad);
            el.setAttribute("ry", rad);
            break;
        }
    }
    if (!el) return;

    el.setAttribute("fill", fillHex);
    el.setAttribute("stroke", "#333");
    el.setAttribute("stroke-width", "1");
    svg.appendChild(el);
    sceneObjects.push({ el: el, textureIndex: currentTextureIndex });
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectTexture(currentTextureIndex);
        selectShape(el);
    });
    // select new shape by default
    selectShape(el);
}

// --------------------------------------------------------------
// Recompute placeholder's fill during create‐texture mode
// --------------------------------------------------------------
function updateExistingShapeColor() {
    const svg = document.getElementById('scene');
    if (!svg || !svg.firstChild) return;
    const bw = parseFloat(document.getElementById('base-weight').value) || 0;
    const sw = parseFloat(document.getElementById('spec-weight').value) || 0;
    const tw = parseFloat(document.getElementById('trans-weight').value) || 0;
    const bcRgb = hexToRgb(document.getElementById('base-color').value);
    const scRgb = hexToRgb(document.getElementById('spec-color').value);
    const tcRgb = hexToRgb(document.getElementById('trans-color').value);
    let r = (bw / 100) * bcRgb.r + (sw / 100) * scRgb.r + (tw / 100) * tcRgb.r;
    let g = (bw / 100) * bcRgb.g + (sw / 100) * scRgb.g + (tw / 100) * tcRgb.g;
    let b = (bw / 100) * bcRgb.b + (sw / 100) * scRgb.b + (tw / 100) * tcRgb.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));
    const fillHex = rgbToHex(r, g, b);
    svg.firstChild.setAttribute('fill', fillHex);
}

// --------------------------------------------------
// Drag‐to‐adjust logic for each number input
// --------------------------------------------------
(function () {
    let dragging = null;
    function onMouseMove(e) {
        if (!dragging) return;
        const deltaY = e.clientY - dragging.startY;
        const step = parseFloat(dragging.input.step) || 1;
        let deltaVal = -deltaY / 2 * step;
        let newVal = dragging.startVal + deltaVal;
        if (step < 1) {
            const decimals = (step.toString().split('.')[1] || '').length;
            newVal = parseFloat(newVal.toFixed(decimals));
        } else {
            newVal = Math.round(newVal);
        }
        newVal = Math.min(Math.max(newVal, 0), 100);
        dragging.input.value = newVal;
        dragging.input.dispatchEvent(new Event('input'));
    }
    function onMouseUp(e) {
        if (dragging) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            dragging = null;
        }
    }
    document.querySelectorAll('.drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            const input = handle.parentElement.querySelector('input[type="number"]');
            dragging = { input: input, startY: e.clientY, startVal: parseFloat(input.value) || 0 };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });

    // Collapse/Expand logic for the right palette
    document.addEventListener('DOMContentLoaded', () => {
        const toggleHeader = document.querySelector('#palette .header.toggle-header');
        toggleHeader.addEventListener('click', () => {
            document.getElementById('palette').classList.toggle('collapsed');
        });
    });

    window.addEventListener('DOMContentLoaded', () => {
        const svg = document.getElementById('scene');
        // any click on the SVG that doesn't hit a shape will bubble here
        svg.addEventListener('click', (e) => {
            // if you clicked the <svg> itself (not a child element)
            if (e.target === svg) {
                selectShape(null);
            }
        });
    });

})();

// --------------------------------------------------
// Show/hide the Preferences popover
// --------------------------------------------------
function showPrefsPopover() {
    if (prefsPopover) return;
    const button = document.querySelector('#texture-create-controls .prefs-button');
    const rect = button.getBoundingClientRect();
    prefsPopover = document.createElement('div');
    prefsPopover.id = 'texture-prefs-popover';
    prefsPopover.style.position = 'absolute';
    prefsPopover.style.background = '#fff';
    prefsPopover.style.border = '1px solid #888';
    prefsPopover.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    prefsPopover.style.padding = '8px';
    prefsPopover.style.zIndex = '20';
    prefsPopover.style.borderRadius = '4px';
    const popoverWidth = 300;
    const top = rect.bottom + 8;
    const left = rect.left + (rect.width / 2) - (popoverWidth / 2);
    prefsPopover.style.top = `${top}px`;
    prefsPopover.style.left = `${left}px`;
    prefsPopover.style.width = `${popoverWidth}px`;
    const arrowBorder = document.createElement('div');
    arrowBorder.className = 'arrow-border';
    prefsPopover.appendChild(arrowBorder);
    const arrowFill = document.createElement('div');
    arrowFill.className = 'arrow-fill';
    prefsPopover.appendChild(arrowFill);
    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.alignItems = 'center';
    row1.style.marginBottom = '8px';
    const label1 = document.createElement('label');
    label1.textContent = 'Create texture shape:';
    label1.style.marginRight = '8px';
    const select1 = document.createElement('select');
    ['Plane', 'Sphere', 'Teapot'].forEach(opt => {
        const o = document.createElement('option');
        o.text = opt;
        o.value = opt.toLowerCase();
        select1.appendChild(o);
    });
    row1.appendChild(label1);
    row1.appendChild(select1);
    const row2 = document.createElement('div');
    row2.style.display = 'flex';
    row2.style.alignItems = 'center';
    const label2 = document.createElement('label');
    label2.textContent = 'Render style:';
    label2.style.marginRight = '8px';
    const select2 = document.createElement('select');
    ['Shaded interior', 'Redshift exterior'].forEach(opt => {
        const o = document.createElement('option');
        o.text = opt;
        o.value = opt.toLowerCase().replace(' ', '-');
        select2.appendChild(o);
    });
    row2.appendChild(label2);
    row2.appendChild(select2);
    prefsPopover.appendChild(row1);
    prefsPopover.appendChild(row2);
    document.body.appendChild(prefsPopover);
    setTimeout(() => {
        window.addEventListener('click', onWindowClick);
    }, 0);
}
function hidePrefsPopover() {
    if (!prefsPopover) return;
    window.removeEventListener('click', onWindowClick);
    document.body.removeChild(prefsPopover);
    prefsPopover = null;
}
function onWindowClick(e) {
    if (!prefsPopover) return;
    if (prefsPopover.contains(e.target)) return;
    if (e.target.closest('.prefs-button')) return;
    hidePrefsPopover();
}

// --------------------------------------------------
// Show/hide the image‐import popover
// --------------------------------------------------
function showImgImportPopover(fieldId) {
    if (imgImportPopover) return;
    imgImportField = fieldId;

    // 1) Find the <input id="fieldId">, then its .thumb-button in the same .row:
    const inputEl = document.getElementById(fieldId);
    const row = inputEl.closest('.row');
    const btn = row.querySelector('.thumb-button');
    const rect = btn.getBoundingClientRect();

    // 2) Create the popover container:
    imgImportPopover = document.createElement('div');
    imgImportPopover.id = 'img-import-popover';
    imgImportPopover.style.position = 'absolute';
    imgImportPopover.style.background = '#fff';
    imgImportPopover.style.border = '1px solid #888';
    imgImportPopover.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    imgImportPopover.style.padding = '8px';
    imgImportPopover.style.zIndex = '30';
    imgImportPopover.style.borderRadius = '4px';

    // 3) Fixed dimensions:
    const popoverWidth = 200;
    const popoverHeight = 160;
    imgImportPopover.style.width = `${popoverWidth}px`;
    imgImportPopover.style.height = `${popoverHeight}px`;

    // 4) Vertical centering:
    const top = rect.top + (rect.height / 2) - (popoverHeight / 2);
    imgImportPopover.style.top = `${top}px`;

    // 5) Horizontal positioning (popover’s right edge sits just left of button):
    const gap = 8;
    const left = rect.left - popoverWidth - gap;
    imgImportPopover.style.left = `${left}px`;

    // 6) Append the right‐pointing arrow:
    const arrowBorder = document.createElement('div');
    arrowBorder.className = 'img-arrow-border';
    imgImportPopover.appendChild(arrowBorder);

    const arrowFill = document.createElement('div');
    arrowFill.className = 'img-arrow-fill';
    imgImportPopover.appendChild(arrowFill);

    // Row: Browse...
    const row1 = document.createElement('div');
    row1.style.marginBottom = '8px';
    const browseBtn = document.createElement('button');
    browseBtn.textContent = 'Browse...';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        // 1) Ignore actual file; just generate a placeholder image:
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Fill with a random color
        const randomColor = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
        ctx.fillStyle = randomColor;
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GENERATED', size / 2, size / 2);

        const dataUrl = canvas.toDataURL();

        // 4) Store it under def[`${prefix}UseImage`] and def[`${prefix}ImgDataUrl`]:
        const idx = selectedObjectTextureIndex;
        if (idx === null) return;                // nothing selected → no op
        const def = textures[idx];
        const prefix = hyphenToCamel(fieldId);

        def[`${prefix}UseImage`] = true;
        def[`${prefix}ImgDataUrl`] = dataUrl;

        updateTextureThumbnail(idx);
        updateAllObjectsForTexture(idx);
        loadTextureIntoEditor(idx);
        updateImgImportControls();
    });
    row1.appendChild(browseBtn);
    row1.appendChild(fileInput);

    // Row: Remove image
    const row2 = document.createElement('div');
    row2.style.marginBottom = '8px';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove image';
    removeBtn.addEventListener('click', () => {
        const idx = selectedObjectTextureIndex;
        if (idx === null) return;
        const def = textures[idx];
        
        const prefix = hyphenToCamel(fieldId);
        def[`${prefix}UseImage`] = false;
        def[`${prefix}ImgDataUrl`] = null;
        updateTextureThumbnail(idx);
        updateAllObjectsForTexture(idx);
        loadTextureIntoEditor(idx);
        updateImgImportControls();
    });
    row2.appendChild(removeBtn);

    // Row: Flip H / Flip V
    const row3 = document.createElement('div');
    row3.style.marginBottom = '8px';
    const flipHBtn = document.createElement('button');
    flipHBtn.textContent = 'Flip Horizontal';
    const flipVBtn = document.createElement('button');
    flipVBtn.textContent = 'Flip Vertical';
    row3.appendChild(flipHBtn);
    row3.appendChild(flipVBtn);

    // Row: Invert image
    const row4 = document.createElement('div');
    const invertBtn = document.createElement('button');
    invertBtn.textContent = 'Invert image';
    row4.appendChild(invertBtn);

    imgImportPopover.appendChild(row1);
    imgImportPopover.appendChild(row2);
    imgImportPopover.appendChild(row3);
    imgImportPopover.appendChild(row4);
    document.body.appendChild(imgImportPopover);
    updateImgImportControls();
    setTimeout(() => {
        // use capture phase so this fires before the SVG click handler
        window.addEventListener('click', onImgPopoverWindowClick, true);
    }, 0);
}

function hyphenToCamel(str) {
    return str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

// --------------------------------------------------------------
// Enable/disable the Remove/Flip/Invert buttons in the popover
// --------------------------------------------------------------
function updateImgImportControls() {
    if (!imgImportPopover || currentTextureIndex === null) return;
    const def = textures[currentTextureIndex];
    const prefix = hyphenToCamel(imgImportField);
    const useImageKey = `${prefix}UseImage`;
    const allBtns = imgImportPopover.querySelectorAll('button');
    const removeBtn = allBtns[1];
    const flipHBtn = allBtns[2];
    const flipVBtn = allBtns[3];
    const invertBtn = allBtns[4];

    const useImage = def[useImageKey];
    removeBtn.disabled = !useImage;
    flipHBtn.disabled = !useImage;
    flipVBtn.disabled = !useImage;
    invertBtn.disabled = !useImage;
}

function hideImgImportPopover() {
    if (!imgImportPopover) return;
    window.removeEventListener('click', onImgPopoverWindowClick, true);
    document.body.removeChild(imgImportPopover);
    imgImportPopover = null;
    imgImportField = null;
}

function onImgPopoverWindowClick(e) {
    if (!imgImportPopover) return;
    if (imgImportPopover.contains(e.target)) return;
    if (e.target.closest('.thumb-button')) return;
    hideImgImportPopover();
    // prevent this click from propagating to the SVG which would
    // otherwise deselect the current object
    e.stopPropagation();
}

// --------------------------------------------------
// Hide or show the three “base” sub-rows when base-weight changes
// --------------------------------------------------
function toggleBaseRows() {
    const baseVal = parseFloat(document.getElementById('base-weight').value) || 0;

    // These are the rows directly under “Base weight”:
    const toToggle = [
        'base-color',
        'metalness',
        'diffuse-roughness'
    ];

    toToggle.forEach(id => {
        const row = document.getElementById(id).closest('.row');
        if (row) row.style.display = (baseVal === 0 ? 'none' : 'flex');
    });
}


// --------------------------------------------------
// Hide or show “specular” sub-rows when spec weight changes
// --------------------------------------------------
function toggleSpecRows() {
    const specVal = parseFloat(document.getElementById('spec-weight').value) || 0;

    // These are exactly the four rows under "Specular weight":
    const toToggle = [
        'spec-color',
        'spec-roughness',
        'roughness-anisotropy',
        'ior'
    ];

    toToggle.forEach(id => {
        const row = document.getElementById(id).closest('.row');
        if (row) row.style.display = (specVal === 0 ? 'none' : 'flex');
    });
}

// --------------------------------------------------
// Remove or show “transmission” sub-rows when trans Weight changes
// --------------------------------------------------
function toggleTransRows() {
    const transWeightEl = document.getElementById('trans-weight');
    const val = parseFloat(transWeightEl.value) || 0;
    const toToggle = [
        'trans-color',
        'depth',
        'scatter',
        'scatter-anisotropy',
        'dispersion-scale',
        'abbe'
    ];
    toToggle.forEach(id => {
        const row = document.getElementById(id).closest('.row');
        if (row) row.style.display = (val === 0) ? 'none' : 'flex';
    });
}

function toggleSubsurfaceRows() {
    const v = parseFloat(document.getElementById('subsurface-weight').value) || 0;
    ['subsurface-color', 'subsurface-radius', 'subsurface-radius-scale', 'subsurface-scatter-anisotropy']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

function toggleCoatRows() {
    const v = parseFloat(document.getElementById('coat-weight').value) || 0;
    ['coat-color', 'coat-roughness', 'coat-roughness-anisotropy', 'coat-ior', 'coat-darkening']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

function toggleFuzzRows() {
    const v = parseFloat(document.getElementById('fuzz-weight').value) || 0;
    ['fuzz-color', 'fuzz-roughness']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

function toggleEmissionRows() {
    const v = parseFloat(document.getElementById('emission-weight').value) || 0;
    ['emission-color']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

function toggleThinFilmRows() {
    const v = parseFloat(document.getElementById('thin-film-weight').value) || 0;
    ['thin-film-thickness','thin-film-ior']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

function toggleGeometryRows() {
    const v = parseFloat(document.getElementById('geometry-weight').value) || 0;
    ['geometry-thin-walled', 'geometry-normal', 'geometry-tangent', 'geometry-coat-normal', 'geometry-coat-tangent']
        .forEach(id => {
            const row = document.getElementById(id).closest('.row');
            if (row) row.style.display = v === 0 ? 'none' : 'flex';
        });
}

// --------------------------------------------------
// DOMContentLoaded: initialize everything + wire events
// --------------------------------------------------
window.addEventListener('DOMContentLoaded', function () {
    // SVG background
    const svg = document.getElementById('scene');
    svg.style.backgroundColor = 'rgb(249, 249, 240)';

    // -- 1) Create default "Texture-1"
    textureCount = 1;
    const defaultDef = {
        id: textureCount,
        name: 'Texture-1',

        baseWeight: 50,
        baseColor: '#ff0000',
        baseColorUseImage: false,
        baseColorImgDataUrl: '',

        specWeight: 0,
        specColor: '#777777',
        specColorUseImage: false,
        specColorImgDataUrl: null,

        transWeight: 0,
        transColor: '#777777',
        transColorUseImage: false,
        transColorImgDataUrl: null,

        metalness: 0,
        metalnessUseImage: false,
        metalnessImgDataUrl: null,

        diffuseRoughness: 0,
        diffuseRoughnessUseImage: false,
        diffuseRoughnessImgDataUrl: null,

        specRoughness: 0,
        specRoughnessUseImage: false,
        specRoughnessImgDataUrl: null,

        roughnessAnisotropy: 0,
        roughnessAnisotropyUseImage: false,
        roughnessAnisotropyImgDataUrl: null,

        ior: 1.5,
        iorUseImage: false,
        iorImgDataUrl: null,

        depth: 0,
        depthUseImage: false,
        depthImgDataUrl: null,

        scatter: 0,
        scatterUseImage: false,
        scatterImgDataUrl: null,

        scatterAnisotropy: 0,
        scatterAnisotropyUseImage: false,
        scatterAnisotropyImgDataUrl: null,

        dispersionScale: 0,
        dispersionScaleUseImage: false,
        dispersionScaleImgDataUrl: null,

        abbe: 0,
        abbeUseImage: false,
        abbeImgDataUrl: null,

        metalnessImg: null,
        diffuseRoughnessImg: null,
        specRoughnessImg: null,
        iorImg: null,
        depthImg: null,
        scatterImg: null,
        dispersionImg: null,
        abbeImg: null,

        subsurfaceWeight: 0,
        subsurfaceColor: '#777777',
        subsurfaceColorUseImage: false,
        subsurfaceColorImgDataUrl: null,
        subsurfaceRadius: 0,
        subsurfaceRadiusUseImage: false,
        subsurfaceRadiusImgDataUrl: null,
        subsurfaceRadiusScale: 0,
        subsurfaceRadiusScaleUseImage: false,
        subsurfaceRadiusScaleImgDataUrl: null,
        subsurfaceScatterAnisotropy: 0,
        subsurfaceScatterAnisotropyUseImage: false,
        subsurfaceScatterAnisotropyImgDataUrl: null,

        coatWeight: 0,
        coatColor: '#777777',
        coatColorUseImage: false,
        coatColorImgDataUrl: null,
        coatRoughness: 0,
        coatRoughnessUseImage: false,
        coatRoughnessImgDataUrl: null,
        coatRoughnessAnisotropy: 0,
        coatRoughnessAnisotropyUseImage: false,
        coatRoughnessAnisotropyImgDataUrl: null,
        coatIor: 0,
        coatIorUseImage: false,
        coatIorImgDataUrl: null,
        coatDarkening: 0,
        coatDarkeningUseImage: false,
        coatDarkeningImgDataUrl: null,

        fuzzWeight: 0,
        fuzzColor: '#777777',
        fuzzColorUseImage: false,
        fuzzColorImgDataUrl: null,
        fuzzRoughness: 0,
        fuzzRoughnessUseImage: false,
        fuzzRoughnessImgDataUrl: null,

        emissionWeight: 0,
        emissionColor: '#777777',
        emissionColorUseImage: false,
        emissionColorImgDataUrl: null,

        thinFilmWeight: 0,
        thinFilmThickness: 0,
        thinFilmThicknessUseImage: false,
        thinFilmThicknessImgDataUrl: null,
        thinFilmIor : 0,
        thinFilmIorUseImage: false,
        thinFilmIorImgDataUrl: null,

        geometryWeight: 0,
        geometryThinWalled: false,
        geometryNormal: 0,
        geometryNormalUseImage: false,
        geometryNormalImgDataUrl: null,
        geometryTangent: 0,
        geometryTangentUseImage: false,
        geometryTangentImgDataUrl: null,
        geometryCoatNormal: 0,
        geometryCoatNormalUseImage: false,
        geometryCoatNormalImgDataUrl: null,
        geometryCoatTangent: 0,
        geometryCoatTangentUseImage: false,
        geometryCoatTangentImgDataUrl: null,

    };
    textures.push(defaultDef);
    addTextureToList(defaultDef, 0);
    selectTexture(0);

    // -- 2) Draw ruler marks and print box behind everything
    const bbox = svg.getBoundingClientRect();
    const sceneW = bbox.width, sceneH = bbox.height;
    for (let y = 0; y <= sceneH; y += 50) {
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute('x1', 0);
        tick.setAttribute('y1', y);
        tick.setAttribute('x2', 5);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', '#888');
        tick.setAttribute('stroke-width', '1');
        svg.appendChild(tick);
    }
    for (let x = 0; x <= sceneW; x += 50) {
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', 0);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', 5);
        tick.setAttribute('stroke', '#888');
        tick.setAttribute('stroke-width', '1');
        svg.appendChild(tick);
    }
    const pbW = sceneW * 0.6;
    const pbH = sceneH * 0.6;
    const pbX = (sceneW - pbW) / 2;
    const pbY = (sceneH - pbH) / 2;
    const printBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    printBox.setAttribute('x', pbX);
    printBox.setAttribute('y', pbY);
    printBox.setAttribute('width', pbW);
    printBox.setAttribute('height', pbH);
    printBox.setAttribute('fill', 'none');
    printBox.setAttribute('stroke', '#ccc');
    printBox.setAttribute('stroke-width', '1');
    svg.appendChild(printBox);

    // -- 3) Wire up buttons & fields --

    document.getElementById('btn-create-texture')
        .addEventListener('click', () => createNewTexture());

    document.getElementById('btn-create-object')
        .addEventListener('click', () => drawRandomShape());

    document.getElementById('btn-show-demo-video')
        .addEventListener('click', () => {
            window.open('pbr-prototype-demo-video.mp4', '_blank');
        });

    document.querySelector('#texture-create-controls .done-button')
        .addEventListener('click', () => exitCreateTextureContext());

    document.querySelector('#texture-create-controls .prefs-button')
        .addEventListener('click', (e) => {
            e.stopPropagation();
            prefsPopover ? hidePrefsPopover() : showPrefsPopover();
        });

    // === HOOK EVERY thumb-button to showImgImportPopover(fieldId) ===
    const imageFields = [
        'base-color',
        'spec-color',
        'trans-color',
        'diffuse-roughness',
        'spec-roughness',
        'metalness',
        'roughness',
        'roughness-anisotropy',
        'ior',
        'depth',
        'scatter',
        'scatter-anisotropy',
        'dispersion-scale',
        'abbe',
        'subsurface-color',
        'coat-color',
        'fuzz-color',
        'emission-color',
        'subsurface-radius',
        'subsurface-radius-scale',
        'subsurface-scatter-anisotropy',
        'coat-roughness',
        'coat-roughness-anisotropy',
        'coat-ior',
        'coat-darkening',
        'fuzz-roughness',
        'thin-film-thickness',
        'thin-film-ior',
        'geometry-normal',
        'geometry-tangent',
        'geometry-coat-normal',
        'geometry-coat-tangent',
    ];
    imageFields.forEach(fieldId => {
        const inputEl = document.getElementById(fieldId);
        if (!inputEl) return;
        const thumbBtn = inputEl.closest('.row').querySelector('.thumb-button');
        if (!thumbBtn) return;
        thumbBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showImgImportPopover(fieldId);
        });
    });

    // Whenever ANY of these “value” fields change, re-write into texture:
    const allIds = [
        'base-weight', 'base-color',
        'spec-weight', 'spec-color',
        'trans-weight', 'trans-color'
    ];
    allIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (inCreateTextureContext) updateExistingShapeColor();
            writeInputsIntoSelectedObjectTexture();
        });
    });

    // AND also for all the numeric IDs:
    const extraIds = [
        'metalness',
        'diffuse-roughness',
        'spec-roughness',
        'roughness-anisotropy',
        'ior',
        'depth',
        'scatter',
        'scatter-anisotropy',
        'dispersion-scale',
        'abbe',
        'subsurface-weight', 'subsurface-radius', 'subsurface-radius-scale', 'subsurface-scatter-anisotropy',
        'coat-weight', 'coat-roughness', 'coat-roughness-anisotropy', 'coat-ior', 'coat-darkening',
        'fuzz-weight', 'fuzz-roughness',
        'emission-weight',
        'geometry-weight', 'geometry-thin-walled', 'geometry-normal', 'geometry-tangent', 'geometry-coat-normal', 'geometry-coat-tangent',
        'texture-size',                // ← add this here
    ];
    extraIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => writeInputsIntoSelectedObjectTexture());
    });

    // When spec-weight or trans-weight changes, show/hide subordinate rows:
    const specWeightEl = document.getElementById('spec-weight');
    specWeightEl.addEventListener('input', toggleSpecRows);
    const transWeightEl = document.getElementById('trans-weight');
    transWeightEl.addEventListener('input', toggleTransRows);
    // When base-weight changes, show/hide base sub-rows:
    const baseWeightEl = document.getElementById('base-weight');
    baseWeightEl.addEventListener('input', toggleBaseRows);

    document.getElementById('subsurface-weight').addEventListener('input', () => {
        toggleSubsurfaceRows();
        writeInputsIntoSelectedObjectTexture();
    });
    document.getElementById('coat-weight').addEventListener('input', () => {
        toggleCoatRows();
        writeInputsIntoSelectedObjectTexture();
    });
    document.getElementById('fuzz-weight').addEventListener('input', () => {
        toggleFuzzRows();
        writeInputsIntoSelectedObjectTexture();
    });
    document.getElementById('emission-weight').addEventListener('input', () => {
        toggleEmissionRows();
        writeInputsIntoSelectedObjectTexture();
    });
    document.getElementById('thin-film-weight').addEventListener('input', () => {
        toggleThinFilmRows();
        writeInputsIntoSelectedObjectTexture();
    });
    document.getElementById('geometry-weight').addEventListener('input', () => {
        toggleGeometryRows();
        writeInputsIntoSelectedObjectTexture();
    });

    // Initialize hiding of spec/trans rows if weights are zero initially:
    toggleSpecRows();
    toggleTransRows();
    toggleBaseRows();
    toggleSubsurfaceRows();
    toggleCoatRows();
    toggleFuzzRows();
    toggleEmissionRows();
    toggleThinFilmRows();
    toggleGeometryRows();

    const sizeBtn = document.getElementById('btn-texture-size');
    const sizeModal = document.getElementById('texture-size-modal');
    const sizeInput = document.getElementById('texture-size-modal-input');
    const sizeOk = document.getElementById('texture-size-ok');
    const sizeCancel = document.getElementById('texture-size-cancel');

    sizeBtn.addEventListener('click', () => {
        // prefill with current texture’s size
        const idx = selectedObjectTextureIndex;
        sizeInput.value = (idx != null) ? textures[idx].textureSize : '';
        sizeModal.style.display = 'flex';
    });

    sizeCancel.addEventListener('click', () => {
        sizeModal.style.display = 'none';
    });

    sizeOk.addEventListener('click', () => {
        const idx = selectedObjectTextureIndex;
        if (idx != null) {
            const val = sizeInput.value.trim();
            textures[idx].textureSize = val;
            // update the inline field immediately
            document.getElementById('texture-size').value = val;
        }
        sizeModal.style.display = 'none';
    });


    // — Duplicate texture flow —
    const dupBtn = document.getElementById('btn-duplicate-texture');
    const dupModal = document.getElementById('duplicate-texture-modal');
    const dupNameFld = document.getElementById('duplicate-texture-name');
    const dupOk = document.getElementById('duplicate-texture-ok');
    const dupCancel = document.getElementById('duplicate-texture-cancel');

    dupBtn.addEventListener('click', () => {
        // prefill with “Copy of …”
        const idx = selectedObjectTextureIndex;
        const baseName = (idx !== null && textures[idx]) ? textures[idx].name : '';
        dupNameFld.value = `Copy of ${baseName}`;
        dupModal.style.display = 'flex';
    });

    dupCancel.addEventListener('click', () => {
        dupModal.style.display = 'none';
    });

    dupOk.addEventListener('click', () => {
        const idx = selectedObjectTextureIndex;
        if (idx === null) return dupModal.style.display = 'none';

        // deep‐clone the current texture definition
        const original = textures[idx];
        const clone = JSON.parse(JSON.stringify(original));
        clone.name = dupNameFld.value.trim() || original.name;

        // append new texture
        const newIndex = textures.length;
        textures.push(clone);
        addTextureToList(clone, newIndex);

        // reassign the selected SVG shape
        if (currentSelectedShape) {
            const obj = sceneObjects.find(o => o.el === currentSelectedShape);
            if (obj) {
                obj.textureIndex = newIndex;
                updateSingleObject(currentSelectedShape, newIndex);
            }
        }

        // refresh UI
        selectShape(currentSelectedShape);
        dupModal.style.display = 'none';
    });


    // — Edit child texture popover & flow —
    const editChildBtn = document.getElementById('btn-edit-child-texture');
    editChildBtn.addEventListener('click', e => {
        e.stopPropagation();
        showChildTexturePopover();
    });

    function showChildTexturePopover() {
        const btnRect = editChildBtn.getBoundingClientRect();

        // 1) create & style as before (omit the old pop.style.top/left)
        const pop = document.createElement('div');
        pop.id = 'child-texture-popover';
        Object.assign(pop.style, {
            position: 'absolute',
            background: '#fff',
            border: '1px solid #888',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            padding: '8px',
            zIndex: '2000',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
        });

        // 2) populate with texture clones...
        textures.forEach((_, i) => {
            const orig = document.querySelector(`.texture-item[data-texture-index="${i}"]`);
            const clone = orig.cloneNode(true);
            clone.style.cursor = 'pointer';
            clone.addEventListener('click', () => {
                // remember which shape we came from
                _restoreSelectedShape = currentSelectedShape;

                // select that texture in Resource Manager
                selectTexture(i);

                // enter “create texture” mode
                enterCreateTextureContext();

                // close the popover
                document.body.removeChild(pop);
            });
            pop.appendChild(clone);
        });

        // 3) append first so we can measure it
        document.body.appendChild(pop);

        // 4) measure and reposition
        const popRect = pop.getBoundingClientRect();
        // align pop’s bottom-right to button’s bottom-left:
        pop.style.left = `${btnRect.left - popRect.width}px`;
        pop.style.top = `${btnRect.bottom - popRect.height}px`;

        // teardown on outside click, in capture phase:
        function onClick(e) {
            if (!pop.contains(e.target) && e.target !== editChildBtn) {
                // remove listener
                window.removeEventListener('click', onClick, true);
                pop.remove();
                // prevent this click from reaching the SVG
                e.stopPropagation();
            }
        }
        // listen in capture so we can stop it before SVG sees it
        window.addEventListener('click', onClick, /* useCapture */ true);
    }

    selectShape(null);

    // — Surface Hatch dialog —
    const hatchBtn = document.getElementById('btn-edit-surface-hatch');
    const hatchModal = document.getElementById('surface-hatch-modal');
    const hatchOk = document.getElementById('surface-hatch-ok');
    const hatchCancel = document.getElementById('surface-hatch-cancel');

    hatchBtn.addEventListener('click', () => {
        hatchModal.style.display = 'flex';
    });

    [hatchOk, hatchCancel].forEach(btn => {
        btn.addEventListener('click', () => {
            hatchModal.style.display = 'none';
        });
    });

});

let currentSelectedShape = null;

function selectShape(el) {
    // remove old highlight
    if (currentSelectedShape) {
        currentSelectedShape.classList.remove('selected-shape');
    }

    // if el is null: clear selection
    if (!el) {
        currentSelectedShape = null;
        selectedObjectTextureIndex = null;
        // grey out & clear editor
        setEditorEnabled(false);
        loadTextureIntoEditor(null);
        // Render palette → “None”
        updateRenderControl(null);
        return;
    }

    // otherwise highlight new shape
    currentSelectedShape = el;
    el.classList.add('selected-shape');

    // find its textureIndex
    const obj = sceneObjects.find(o => o.el === el);
    selectedObjectTextureIndex = obj ? obj.textureIndex : null;

    // load & enable editor
    setEditorEnabled(true);
    loadTextureIntoEditor(selectedObjectTextureIndex);
    toggleBaseRows();
    toggleSpecRows();
    toggleTransRows();
    updateImgImportControls();

    // update Render palette
    updateRenderControl(selectedObjectTextureIndex);    
}


function updateRenderControl(idx) {
    const rc = document.getElementById('render-control');
    const thumb = document.getElementById('render-thumb');
    const name = document.getElementById('render-name');

    if (idx === null) {
        thumb.style.backgroundImage = '';
        thumb.style.backgroundColor = '#ccc';
        name.textContent = 'None';
        rc.style.pointerEvents = 'none';
        rc.style.opacity = '0.5';
        return;
    }

    rc.style.pointerEvents = 'auto';
    rc.style.opacity = '1';

    const def = textures[idx];
    name.textContent = def.name;

    // same blend logic as updateTextureThumbnail(...)
    const bw = def.baseWeight / 100;
    const sw = def.specWeight / 100;
    const tw = def.transWeight / 100;
    const bc = hexToRgb(def.baseColor);
    const sc = hexToRgb(def.specColor);
    const tc = hexToRgb(def.transColor);

    let r = bw * bc.r + sw * sc.r + tw * tc.r;
    let g = bw * bc.g + sw * sc.g + tw * tc.g;
    let b = bw * bc.b + sw * sc.b + tw * tc.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));

    const fillHex = rgbToHex(r, g, b);
    thumb.style.backgroundImage = '';
    thumb.style.backgroundColor = fillHex;
}


// attach render-control click to popover
document.addEventListener('DOMContentLoaded', () => {
    const rc = document.getElementById('render-control');
      rc.addEventListener('click', showRenderPopover);
    });

// compute the blended fill for a texture definition
function computeFill(def) {
    const bw = def.baseWeight / 100;
    const sw = def.specWeight / 100;
    const tw = def.transWeight / 100;
    const bc = hexToRgb(def.baseColor);
    const sc = hexToRgb(def.specColor);
    const tc = hexToRgb(def.transColor);
    let r = bw * bc.r + sw * sc.r + tw * tc.r;
    let g = bw * bc.g + sw * sc.g + tw * tc.g;
    let b = bw * bc.b + sw * sc.b + tw * tc.b;
    r = Math.round(Math.min(Math.max(r, 0), 255));
    g = Math.round(Math.min(Math.max(g, 0), 255));
    b = Math.round(Math.min(Math.max(b, 0), 255));
    return rgbToHex(r, g, b);
}

// only repaint one SVG element
function updateSingleObject(el, textureIndex) {
    const def = textures[textureIndex];
    const fill = computeFill(def);
    el.setAttribute('fill', fill);
}

function showRenderPopover() {
    // 1) Create popover container
    const pop = document.createElement('div');
    pop.id = 'render-popover';
    Object.assign(pop.style, {
        position: 'absolute',
        top: `${document.getElementById('render-control').getBoundingClientRect().bottom + 8}px`,
        left: `${document.getElementById('render-control').getBoundingClientRect().left}px`,
        width: '220px',           // wide enough for 2×(80px+padding)
        background: '#fff',
        border: '1px solid #888',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        padding: '8px',
        zIndex: '2000',
        display: 'flex',          // flex layout...
        flexWrap: 'wrap',         // …that wraps
        gap: '8px',               // spacing between items
    });

    // 2) Clone each texture-item from Resource Manager
    textures.forEach((_, i) => {
        const orig = document.querySelector(`.texture-item[data-texture-index="${i}"]`);
        const clone = orig.cloneNode(true);

        // 3) Outline the one matching the selected object
        if (i === selectedObjectTextureIndex) {
            clone.classList.add('active');
        }

        // 4) Click handler: reassign only this shape
        clone.addEventListener('click', () => {
            if (currentSelectedShape) {
                const obj = sceneObjects.find(o => o.el === currentSelectedShape);
                if (obj) {
                    obj.textureIndex = i;
                    updateSingleObject(currentSelectedShape, i);
                    selectShape(currentSelectedShape); // reload editor + render thumb
                }
            }
            document.body.removeChild(pop);
        });

        pop.appendChild(clone);
    });

    // 5) Show & outside-click teardown
    document.body.appendChild(pop);
    // ─── outside‐click teardown in capture phase ───
    setTimeout(() => {
        function onClick(e) {
            const rcBtn = document.getElementById('render-control');
            if (!pop.contains(e.target) && !rcBtn.contains(e.target)) {
                // remove listener (capture)
                window.removeEventListener('click', onClick, true);
                pop.remove();
                // prevent SVG from seeing this click
                e.stopPropagation();
            }
        }
        // NOTE the “true” → capture phase
        window.addEventListener('click', onClick, true);
    }, 0);
}


