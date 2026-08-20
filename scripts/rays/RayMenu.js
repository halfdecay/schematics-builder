/**
 * RayMenu.js - Right-panel ray configuration (Phase 3)
 * Renders into #ray-panel-body. Updates whenever selection changes via
 * ComponentManager.onSelectionChanged callback.
 */

import { ComponentManager, componentManager } from '../components/ComponentManager.js';
import { updateRays } from './DrawRays.js';
import { rebuildDebugForComponent } from '../utils/DebugLayer.js';
import { APERTURE_RADIUS_STEP, APERTURE_OFFSET_STEP, ARRAY_SIZE_RATIO_STEP, ARRAY_POSITION_RATIO_STEP,
         DEFAULT_SOLID_RAY_COLOR, DEFAULT_RAY_POLYGON_OPACITY, MIN_SCALE, MAX_SCALE,
         SCALE_SNAP_INCREMENT } from '../config.js';
import { actionHistory } from '../history/ActionHistory.js';

/** Extract the 0-359 hue from either an HSL or 6-digit hex color string. */
function _colorToHue(color) {
  if (!color) return 0;
  const hslMatch = color.match(/hsl\((\d+)/);
  if (hslMatch) return parseInt(hslMatch[1]);
  const hex = color.replace('#', '');
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r)      h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return Math.round(h * 60 + 360) % 360;
}

function _hueToRayColor(hue) {
  return `hsl(${hue}, 70%, 50%)`;
}

let currentComponent = null;
let currentBaseComponent = null;
let currentParentId = null;
let currentRayChild = null;
let currentConnectionKey = null;

const CONNECTION_FIELDS = new Set([
  'rayShape', 'rayPolygonColor', 'rayPolygonOpacity', 'rayColorInheritFromParent',
  'rayGradientEnabled', 'rayPolygonColor2', 'rayFlip', 'rayWidthMode', 'apertureRadius',
  'apertureCenterOffset', 'arraySegments', 'arraySizeRatio', 'arrayPositionRatio', 'coneAngle'
]);

function createRayEditor(component, parentId) {
  if (parentId == null) return component;
  const config = component.getRayConfig(parentId);
  return new Proxy(component, {
    get(target, prop) {
      if (CONNECTION_FIELDS.has(prop)) return config[prop];
      if (prop === 'parent') return parentId;
      if (prop === 'setRayShape') return value => { config.rayShape = value; };
      if (prop === 'setApertureRadius') return value => { config.apertureRadius = value; };
      if (prop === 'setApertureCenterOffset') return value => { config.apertureCenterOffset = value; };
      if (prop === 'setArraySegments') return value => { config.arraySegments = Math.max(1, Math.min(10, Math.round(value))); };
      if (prop === 'setArraySizeRatio') return value => { config.arraySizeRatio = Math.max(0, value); };
      if (prop === 'setArrayPositionRatio') return value => { config.arrayPositionRatio = Math.max(0, value); };
      return Reflect.get(target, prop, target);
    },
    set(target, prop, value) {
      if (CONNECTION_FIELDS.has(prop)) { config[prop] = value; return true; }
      return Reflect.set(target, prop, value, target);
    }
  });
}

function getComponentId(component) {
  for (const [id, candidate] of componentManager.components) {
    if (candidate === component) return id;
  }
  return null;
}

function getRayConnections(component) {
  if (!component) return [];
  const componentId = getComponentId(component);
  if (componentId == null) return [];

  const incoming = component.getParentIds().map(parentId => ({
    key: `${parentId}:${componentId}`,
    direction: 'incoming',
    parentId,
    child: component
  }));
  const outgoing = (component.children || []).flatMap(childId => {
    const child = componentManager.getComponent(childId);
    if (!child || !child.getParentIds().includes(componentId)) return [];
    return [{
      key: `${componentId}:${childId}`,
      direction: 'outgoing',
      parentId: componentId,
      child
    }];
  });
  return [...incoming, ...outgoing];
}

function selectRayConnection(connection) {
  currentConnectionKey = connection?.key ?? null;
  currentParentId = connection?.parentId ?? null;
  currentRayChild = connection?.child ?? currentBaseComponent;
  currentComponent = createRayEditor(currentRayChild, currentParentId);
}

// â”€â”€â”€ HTML template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EMPTY_HTML = `
  <div class="rp-empty">
    <p>Select a component<br>to configure its properties</p>
  </div>
`;

function buildPanelHTML(comp) {
  const hue1 = _colorToHue(comp.rayPolygonColor  || DEFAULT_SOLID_RAY_COLOR);
  const hue2 = _colorToHue(comp.rayPolygonColor2 || comp.rayPolygonColor || DEFAULT_SOLID_RAY_COLOR);

  const shape    = comp.rayShape              ?? 'collimated';
  const opacity  = comp.rayPolygonOpacity     ?? DEFAULT_RAY_POLYGON_OPACITY;
  const radius   = comp.apertureRadius        ?? 15;
  const offset   = comp.apertureCenterOffset  ?? 0;
  const segments = comp.arraySegments         ?? 3;
  const sizeRatio = comp.arraySizeRatio        ?? 0.8;
  const positionRatio = comp.arrayPositionRatio ?? 1.0;
  const inheritColor = comp.rayColorInheritFromParent ?? true;
  const gradientEnabled = comp.rayGradientEnabled ?? false;
  const rayFlip = comp.rayFlip ?? false;
  const widthMode = comp.rayWidthMode ?? 'projected';
  // Non-entry composite members have all ray controls locked in the UI;
  // only the entry port may be edited. Ray propagation still flows normally.
  const compLocked = comp.isCompositeInstance && !comp.isEntryPort;

  const arrayDisplay = shape === 'array' ? '' : 'none';

  // Radius slider is disabled when the parent fully controls the child aperture:
  //   - collimated: always parent-controlled
  //   - divergent with a parent that already has a non-zero cone angle
  //   - array: user-adjustable (not auto-scaled)
  const parentComp = (comp.parent != null) ? componentManager.getComponent(comp.parent) : null;
  const divergentParentControlled = shape === 'divergent' && parentComp && parentComp.coneAngle;
  const radiusDisabled = compLocked || (widthMode !== 'fixed' && !!parentComp &&
    (shape === 'collimated' || divergentParentControlled));
  const radiusLabel = shape === 'aperture-clipped' ? 'Beam Radius' : 'Aperture Radius';
  const rayConnections = getRayConnections(currentBaseComponent);
  const connectionOptions = rayConnections.map(connection => {
    const otherId = connection.direction === 'incoming'
      ? connection.parentId
      : getComponentId(connection.child);
    const other = componentManager.getComponent(otherId);
    const name = other ? other.name : 'Component';
    const direction = connection.direction === 'incoming' ? 'Incoming ←' : 'Outgoing →';
    return `<option value="${connection.key}" ${connection.key === currentConnectionKey ? 'selected' : ''}>${direction} ${name} (#${otherId})</option>`;
  }).join('');
  const rotation = currentBaseComponent?.rotation ?? 0;
  const scale = currentBaseComponent?.scale ?? 1;

  const objectSection = `
    <div class="rp-section">
      <div class="rp-section-title">Object</div>
      <div class="rp-field">
        <label class="rp-label" for="rp-rotation">Rotation (deg)</label>
        <input type="number" id="rp-rotation" class="rp-number" step="1" value="${rotation.toFixed(2)}">
      </div>
      <div class="rp-field">
        <label class="rp-label" for="rp-scale">Scale</label>
        <input type="number" id="rp-scale" class="rp-number" min="${MIN_SCALE}" max="${MAX_SCALE}" step="${SCALE_SNAP_INCREMENT}" value="${scale.toFixed(2)}">
      </div>
    </div>`;

  if (currentBaseComponent?.isAnnotation) return objectSection;

  return `
    ${compLocked ? '<div class="rp-locked-notice">Locked — edit via entry port</div>' : ''}
    ${objectSection}
    <div class="rp-section">
      <div class="rp-section-title">Ray Connections</div>
      ${rayConnections.length
        ? `<select id="rp-connection" class="rp-select">${connectionOptions}</select>`
        : '<div class="rp-empty-connection">No ray connections</div>'}
    </div>
    <div class="rp-section">
      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}" for="rp-shape">Ray Shape</label>
        <select id="rp-shape" class="rp-select"${compLocked ? ' disabled' : ''}>
          <option value="collimated" ${shape==='collimated'?'selected':''}>Collimated</option>
          <option value="aperture-clipped" ${shape==='aperture-clipped'?'selected':''}>Aperture-clipped collimated</option>
          <option value="divergent"  ${shape==='divergent' ?'selected':''}>Divergent</option>
          <option value="convergent" ${shape==='convergent'?'selected':''}>Convergent</option>
          <option value="manual"     ${shape==='manual'    ?'selected':''}>Manual</option>
          <option value="array"      ${shape==='array'     ?'selected':''}>Array</option>
        </select>
      </div>
      <div class="rp-field rp-field-checkbox">
        <label class="rp-checkbox-label${compLocked ? ' rp-label-disabled' : ''}" for="rp-ray-flip">
          <input type="checkbox" id="rp-ray-flip" ${rayFlip ? 'checked' : ''}${compLocked ? ' disabled' : ''}>
          Flip ray edges
        </label>
      </div>
      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}" for="rp-width-mode">Ray Width</label>
        <select id="rp-width-mode" class="rp-select"${compLocked ? ' disabled' : ''}>
          <option value="projected" ${widthMode === 'projected' ? 'selected' : ''}>Projected aperture</option>
          <option value="fixed" ${widthMode === 'fixed' ? 'selected' : ''}>Fixed aperture radius</option>
        </select>
      </div>
    </div>

    <div class="rp-section rp-color-section">
      <div class="rp-section-title">Color</div>

      <div class="rp-field rp-field-checkbox rp-checkbox-row">
        <label class="rp-checkbox-label${compLocked ? ' rp-label-disabled' : ''}" for="rp-inherit-color">
          <input type="checkbox" id="rp-inherit-color" ${inheritColor ? 'checked' : ''}${compLocked ? ' disabled' : ''}>
          Inherit from parent${compLocked ? ' <span class="rp-lock-note">(entry port only)</span>' : ''}
        </label>
        <label class="rp-gradient-toggle${compLocked ? ' rp-label-disabled' : ''}">
          <input type="checkbox" id="rp-gradient" ${gradientEnabled ? 'checked' : ''}${compLocked ? ' disabled' : ''}>
          Color Gradient
        </label>
      </div>

      <div class="rp-field">
        <div class="rp-hue-label-row">
          <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Color Hue</label>
          <span class="rp-inline-inputs">
            <input type="number" id="rp-hue1-number" class="rp-number rp-number-compact" min="0" max="359" step="1" value="${hue1}"${compLocked ? ' disabled' : ''}>
            <input type="number" id="rp-hue2-number" class="rp-number rp-number-compact" min="0" max="359" step="1" value="${hue2}" style="display:${gradientEnabled ? '' : 'none'}"${compLocked ? ' disabled' : ''}>
          </span>
        </div>
        <div class="rp-hue-track" id="rp-hue-track"${compLocked ? ' style="pointer-events:none;opacity:0.5"' : ''}>
          <div class="rp-hue-knob active" id="rp-knob1"
               style="left:${(hue1 / 359 * 100).toFixed(2)}%" title="Upper aperture (knob 1): ${hue1}&deg;"></div>
          <div class="rp-hue-knob" id="rp-knob2"
               style="left:${(hue2 / 359 * 100).toFixed(2)}%;display:${gradientEnabled ? 'block' : 'none'}" title="Lower aperture (knob 2): ${hue2}&deg;"></div>
        </div>
      </div>

      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Opacity <input type="number" id="rp-opacity-number" class="rp-number rp-number-compact" min="0" max="1" step="0.05" value="${opacity.toFixed(2)}"${compLocked ? ' disabled' : ''}></label>
        <input type="range" id="rp-opacity" class="rp-slider"
               min="0" max="1" step="0.05" value="${opacity}"${compLocked ? ' disabled' : ''}>
      </div>
    </div>

    <div class="rp-section">
      <div class="rp-field">
        <label class="rp-label${radiusDisabled ? ' rp-label-disabled' : ''}"><span id="rp-radius-label-text">${radiusLabel}</span> <input type="number" id="rp-radius-number" class="rp-number rp-number-compact" min="0" max="200" step="${APERTURE_RADIUS_STEP}" value="${radius}"${radiusDisabled ? ' disabled' : ''}></label>
        <input type="range" id="rp-radius" class="rp-slider"
               min="0" max="200" step="${APERTURE_RADIUS_STEP}" value="${radius}"${radiusDisabled ? ' disabled' : ''}>
      </div>

      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Center Offset <input type="number" id="rp-offset-number" class="rp-number rp-number-compact" min="-100" max="100" step="${APERTURE_OFFSET_STEP}" value="${offset}"${compLocked ? ' disabled' : ''}></label>
        <input type="range" id="rp-offset" class="rp-slider"
               min="-100" max="100" step="${APERTURE_OFFSET_STEP}" value="${offset}"${compLocked ? ' disabled' : ''}>
      </div>
    </div>

    <div class="rp-section rp-array-section" id="rp-array-section" style="display:${arrayDisplay}">
      <div class="rp-section-title">Array Settings</div>
      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Num of sub-aperture</label>
        <input type="number" id="rp-segments" class="rp-number"
               min="1" max="10" step="1" value="${segments}"${compLocked ? ' disabled' : ''}>
      </div>
      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Size of sub-aperture <input type="number" id="rp-size-ratio-number" class="rp-number rp-number-compact" min="0" max="2" step="${ARRAY_SIZE_RATIO_STEP}" value="${sizeRatio.toFixed(2)}"${compLocked ? ' disabled' : ''}></label>
        <input type="range" id="rp-size-ratio" class="rp-slider"
               min="0" max="2" step="${ARRAY_SIZE_RATIO_STEP}" value="${sizeRatio}"${compLocked ? ' disabled' : ''}>
      </div>
      <div class="rp-field">
        <label class="rp-label${compLocked ? ' rp-label-disabled' : ''}">Position of sub-aperture <input type="number" id="rp-position-ratio-number" class="rp-number rp-number-compact" min="0" max="2" step="${ARRAY_POSITION_RATIO_STEP}" value="${positionRatio.toFixed(2)}"${compLocked ? ' disabled' : ''}></label>
        <input type="range" id="rp-position-ratio" class="rp-slider"
               min="0" max="2" step="${ARRAY_POSITION_RATIO_STEP}" value="${positionRatio}"${compLocked ? ' disabled' : ''}>
      </div>
    </div>
  `;
}

// â”€â”€â”€ Wire events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function wireEvents(body) {
  const get = id => body.querySelector('#' + id);

  function syncSliderProgress(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const value = parseFloat(slider.value || '0');
    const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--rp-slider-progress', `${Math.max(0, Math.min(100, progress))}%`);
  }

  body.querySelectorAll('.rp-slider').forEach(slider => {
    syncSliderProgress(slider);
    slider.addEventListener('input', () => syncSliderProgress(slider));
    slider.addEventListener('change', () => syncSliderProgress(slider));
  });

  get('rp-connection')?.addEventListener('change', e => {
    const connection = getRayConnections(currentBaseComponent)
      .find(candidate => candidate.key === e.target.value);
    selectRayConnection(connection);
    body.innerHTML = buildPanelHTML(currentComponent);
    wireEvents(body);
  });

  get('rp-rotation')?.addEventListener('input', e => {
    const angle = parseFloat(e.target.value);
    if (!currentBaseComponent || !Number.isFinite(angle)) return;
    beginControlHistory('Set object rotation', 'object-rotation');
    if (componentManager.selectedIds.size > 1) {
      const ids = Array.from(componentManager.selectedIds);
      const centroid = componentManager.getGroupCentroid(ids);
      const states = componentManager.getGroupInitialStates(ids);
      componentManager.updateGroupRotation(ids, centroid, angle - currentBaseComponent.rotation, states);
    } else {
      const entry = [...componentManager.components.entries()].find(([, component]) => component === currentBaseComponent);
      if (entry) componentManager.updateComponentRotation(entry[0], angle);
    }
    updateRays();
    rebuildDebugForComponent(currentBaseComponent);
  });
  get('rp-rotation')?.addEventListener('change', () => commitControlHistory());

  get('rp-scale')?.addEventListener('input', e => {
    const requestedScale = parseFloat(e.target.value);
    if (!currentBaseComponent || !Number.isFinite(requestedScale)) return;
    beginControlHistory('Set object scale', 'object-scale');

    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, requestedScale));
    if (componentManager.selectedIds.size > 1) {
      const ids = Array.from(componentManager.selectedIds);
      const currentScale = currentBaseComponent.getScale();
      if (currentScale <= 0) return;
      const centroid = componentManager.getGroupCentroid(ids);
      const states = componentManager.getGroupInitialStates(ids);
      let scaleFactor = clampedScale / currentScale;
      let minAllowedFactor = 0;
      let maxAllowedFactor = Infinity;
      states.forEach(state => {
        minAllowedFactor = Math.max(minAllowedFactor, MIN_SCALE / state.scale);
        maxAllowedFactor = Math.min(maxAllowedFactor, MAX_SCALE / state.scale);
      });
      scaleFactor = Math.max(minAllowedFactor, Math.min(maxAllowedFactor, scaleFactor));
      componentManager.updateGroupScale(ids, centroid, scaleFactor, states);
    } else {
      const entry = [...componentManager.components.entries()].find(([, component]) => component === currentBaseComponent);
      if (entry) componentManager.updateComponentScale(entry[0], clampedScale);
    }

    e.target.value = currentBaseComponent.getScale().toFixed(2);
    updateRays();
    rebuildDebugForComponent(currentBaseComponent);
  });
  get('rp-scale')?.addEventListener('change', e => {
    if (currentBaseComponent) e.target.value = currentBaseComponent.getScale().toFixed(2);
    commitControlHistory();
  });

  const apply = () => {
    if (!currentComponent) return;
    updateRays();
    rebuildDebugForComponent(currentRayChild || currentBaseComponent || currentComponent);
  };

  const beginControlHistory = (label, type) => {
    if (!actionHistory.isApplyingHistory) actionHistory.begin(label, type);
  };

  const commitControlHistory = () => {
    if (!actionHistory.isApplyingHistory) actionHistory.commit();
  };

  // Annotation components have object transforms but no optical-ray settings.
  if (currentBaseComponent?.isAnnotation) return;

  get('rp-shape').addEventListener('change', e => {
    actionHistory.run('Change ray shape', 'ray-shape', () => {
      if (!currentComponent) return;
      const newShape = e.target.value;
      currentComponent.setRayShape(newShape);
      if (newShape === 'collimated' || newShape === 'aperture-clipped') currentComponent.coneAngle = 0;
      body.querySelector('#rp-array-section').style.display =
        newShape === 'array' ? '' : 'none';

      // Re-evaluate whether the radius slider should be enabled or disabled.
      const parentComp = (currentComponent.parent != null)
        ? componentManager.getComponent(currentComponent.parent) : null;
      const divergentParentControlled = newShape === 'divergent' && parentComp && parentComp.coneAngle;
      const radiusDisabled = currentComponent.rayWidthMode !== 'fixed' && !!parentComp &&
        (newShape === 'collimated' || divergentParentControlled);
      const radiusSlider = get('rp-radius');
      const radiusNumber = get('rp-radius-number');
      const radiusLabel  = radiusSlider?.closest('.rp-field')?.querySelector('.rp-label');
      const radiusLabelText = get('rp-radius-label-text');
      if (radiusSlider) radiusSlider.disabled = radiusDisabled;
      if (radiusNumber) radiusNumber.disabled = radiusDisabled;
      if (radiusLabel) radiusLabel.classList.toggle('rp-label-disabled', radiusDisabled);
      if (radiusLabelText) radiusLabelText.textContent = newShape === 'aperture-clipped' ? 'Beam Radius' : 'Aperture Radius';

      apply();
    });
  });

  get('rp-ray-flip').addEventListener('change', e => {
    actionHistory.run('Flip ray edges', 'ray-flip', () => {
      if (!currentComponent) return;
      currentComponent.rayFlip = e.target.checked;
      apply();
    });
  });

  get('rp-width-mode').addEventListener('change', e => {
    actionHistory.run('Change ray width mode', 'ray-width-mode', () => {
      if (!currentComponent) return;
      currentComponent.rayWidthMode = e.target.value === 'fixed' ? 'fixed' : 'projected';
      if (currentParentId == null || currentBaseComponent?.parent === currentParentId) {
        currentBaseComponent.rayWidthMode = currentComponent.rayWidthMode;
      }

      const radiusSlider = get('rp-radius');
      const radiusNumber = get('rp-radius-number');
      const radiusLabel = radiusSlider?.closest('.rp-field')?.querySelector('.rp-label');
      const parentComp = currentComponent.parent != null
        ? componentManager.getComponent(currentComponent.parent)
        : null;
      const divergentParentControlled = currentComponent.rayShape === 'divergent' && parentComp && parentComp.coneAngle;
      const radiusDisabled = currentComponent.rayWidthMode !== 'fixed' && !!parentComp &&
        (currentComponent.rayShape === 'collimated' || divergentParentControlled);
      if (radiusSlider) radiusSlider.disabled = radiusDisabled;
      if (radiusNumber) radiusNumber.disabled = radiusDisabled;
      if (radiusLabel) radiusLabel.classList.toggle('rp-label-disabled', radiusDisabled);
      apply();
    });
  });

  get('rp-inherit-color').addEventListener('change', e => {
    actionHistory.run('Toggle color inheritance', 'ray-inherit-color', () => {
      if (!currentComponent) return;
      currentComponent.rayColorInheritFromParent = e.target.checked;
      if (e.target.checked && currentComponent.parent != null) {
        const parentComp = componentManager.getComponent(currentComponent.parent);
        if (parentComp) {
          const inheritedColor    = parentComp.rayPolygonColor;
          const inheritedOpacity  = parentComp.rayPolygonOpacity;
          const inheritedGradient = parentComp.rayGradientEnabled;
          const inheritedColor2   = parentComp.rayPolygonColor2;
          currentComponent.rayPolygonColor    = inheritedColor;
          currentComponent.rayPolygonOpacity  = inheritedOpacity;
          currentComponent.rayGradientEnabled = inheritedGradient;
          currentComponent.rayPolygonColor2   = inheritedColor2;
          // Sync knob1 position
          const knob1 = get('rp-knob1');
          const knob2 = get('rp-knob2');
          const hueVal = body.querySelector('#rp-hue-val');
          const h1 = _colorToHue(inheritedColor);
          const h2 = _colorToHue(inheritedColor2);
          if (knob1) knob1.style.left = `${(h1/359*100).toFixed(2)}%`;
          if (knob2) knob2.style.left = `${(h2/359*100).toFixed(2)}%`;
          if (get('rp-hue1-number')) get('rp-hue1-number').value = h1;
          if (get('rp-hue2-number')) get('rp-hue2-number').value = h2;
          if (knob2) knob2.style.display = inheritedGradient ? 'block' : 'none';
          const gradCb = get('rp-gradient');
          if (gradCb) gradCb.checked = inheritedGradient;
          if (hueVal) hueVal.innerHTML = inheritedGradient ? `${h1}&#176; / ${h2}&#176;` : `${h1}&#176;`;
          // Sync opacity slider UI
          const opSlider = get('rp-opacity');
          const opVal    = body.querySelector('#rp-opacity-val');
          if (opSlider) {
            opSlider.value = inheritedOpacity;
            syncSliderProgress(opSlider);
            if (opVal) opVal.textContent = inheritedOpacity.toFixed(2);
            if (get('rp-opacity-number')) get('rp-opacity-number').value = inheritedOpacity.toFixed(2);
          }
          propagateColor(currentComponent, inheritedColor, inheritedOpacity, inheritedGradient, inheritedColor2);
          apply();
        }
      }
    });
  });

  // Propagate color/opacity/gradient down the tree to all descendants that opt-in.
  // Any null argument is skipped (i.e. that property is not changed on descendants).
  function propagateColor(comp, color, opacity, gradientEnabled, color2) {
    for (const childId of comp.children) {
      const child = componentManager.getComponent(childId);
      if (!child) continue;
      if (child.rayColorInheritFromParent ?? true) {
        if (color !== null && color !== undefined)           child.rayPolygonColor    = color;
        if (opacity !== null && opacity !== undefined)       child.rayPolygonOpacity  = opacity;
        if (gradientEnabled !== null && gradientEnabled !== undefined) child.rayGradientEnabled = gradientEnabled;
        if (color2 !== null && color2 !== undefined)         child.rayPolygonColor2   = color2;
        propagateColor(child, color, opacity, gradientEnabled, color2);
      }
    }
  }

  function untickInherit() {
    if (!currentComponent || !currentComponent.rayColorInheritFromParent) return;
    currentComponent.rayColorInheritFromParent = false;
    const cb = get('rp-inherit-color');
    if (cb) cb.checked = false;
  }

  // ── Dual-knob hue track ───────────────────────────────────────────────────

  /** Convert a pointer clientX to a 0–359 hue value relative to the hue track. */
  function _clientXToHue(clientX) {
    const track = get('rp-hue-track');
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.round((x / rect.width) * 359);
  }

  /** Update a knob's CSS left position from a hue value (0–359). */
  function _setKnobHue(knobEl, hue, isKnob1) {
    knobEl.style.left = `${(hue / 359 * 100).toFixed(2)}%`;
    knobEl.title = `${isKnob1 ? 'Upper' : 'Lower'} aperture (knob ${isKnob1 ? 1 : 2}): ${hue}°`;
  }

  /** Attach pointer-drag listeners to a hue knob. */
  function _attachKnobDrag(knobEl, isKnob1) {
    knobEl.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      actionHistory.begin(isKnob1 ? 'Change ray color' : 'Change gradient color', 'ray-color');

      // Activate this knob visually
      const otherKnob = get(isKnob1 ? 'rp-knob2' : 'rp-knob1');
      knobEl.classList.add('active');
      if (otherKnob) otherKnob.classList.remove('active');

      const onMove = (moveEvent) => {
        if (!currentComponent) return;
        const hue = _clientXToHue(moveEvent.clientX);
        _setKnobHue(knobEl, hue, isKnob1);
        const hueInput = get(isKnob1 ? 'rp-hue1-number' : 'rp-hue2-number');
        if (hueInput) hueInput.value = hue;
        const color = `hsl(${hue}, 70%, 50%)`;

        untickInherit();
        if (isKnob1) {
          currentComponent.rayPolygonColor = color;
          propagateColor(currentComponent, color, null, null, null);
        } else {
          currentComponent.rayPolygonColor2 = color;
          propagateColor(currentComponent, null, null, null, color);
        }

        // Update hue value label
        const hueVal = body.querySelector('#rp-hue-val');
        if (hueVal) {
          const h1 = _colorToHue(currentComponent.rayPolygonColor);
          const h2 = _colorToHue(currentComponent.rayPolygonColor2);
          hueVal.innerHTML = (currentComponent.rayGradientEnabled)
            ? `${h1}&#176; / ${h2}&#176;`
            : `${h1}&#176;`;
        }
        apply();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        actionHistory.commit();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  const knob1El = get('rp-knob1');
  const knob2El = get('rp-knob2');
  if (knob1El) _attachKnobDrag(knob1El, true);
  if (knob2El) _attachKnobDrag(knob2El, false);

  const applyHueNumber = (isPrimary) => {
    const input = get(isPrimary ? 'rp-hue1-number' : 'rp-hue2-number');
    if (!input) return;
    input.addEventListener('input', () => {
      const hue = Math.max(0, Math.min(359, parseInt(input.value, 10) || 0));
      beginControlHistory(isPrimary ? 'Set ray color' : 'Set gradient color', 'ray-color');
      untickInherit();
      const color = _hueToRayColor(hue);
      if (isPrimary) currentComponent.rayPolygonColor = color;
      else currentComponent.rayPolygonColor2 = color;
      const knob = get(isPrimary ? 'rp-knob1' : 'rp-knob2');
      if (knob) _setKnobHue(knob, hue, isPrimary);
      apply();
    });
    input.addEventListener('change', commitControlHistory);
  };
  applyHueNumber(true);
  applyHueNumber(false);

  // Gradient toggle
  const gradientCb = get('rp-gradient');
  if (gradientCb) {
    gradientCb.addEventListener('change', e => {
      actionHistory.run('Toggle ray gradient', 'ray-gradient', () => {
        if (!currentComponent) return;
        untickInherit();
        const enabled = e.target.checked;
        currentComponent.rayGradientEnabled = enabled;
        if (enabled) {
          const h1 = _colorToHue(currentComponent.rayPolygonColor);
          const spacedHue = (h1 + 30) % 360;
          currentComponent.rayPolygonColor2 = _hueToRayColor(spacedHue);
          if (knob2El) _setKnobHue(knob2El, spacedHue, false);
          propagateColor(currentComponent, null, null, null, currentComponent.rayPolygonColor2);
        }
        // Show/hide knob2
        if (knob2El) knob2El.style.display = enabled ? 'block' : 'none';
        const hue2Input = get('rp-hue2-number');
        if (hue2Input) {
          hue2Input.style.display = enabled ? '' : 'none';
          hue2Input.value = _colorToHue(currentComponent.rayPolygonColor2);
        }
        // Update value label
        const hueVal = body.querySelector('#rp-hue-val');
        if (hueVal) {
          const h1 = _colorToHue(currentComponent.rayPolygonColor);
          const h2 = _colorToHue(currentComponent.rayPolygonColor2);
          hueVal.innerHTML = enabled ? `${h1}&#176; / ${h2}&#176;` : `${h1}&#176;`;
        }
        propagateColor(currentComponent, null, null, enabled, null);
        apply();
      });
    });
  }

  get('rp-opacity').addEventListener('input', e => {
    if (!currentComponent) return;
    beginControlHistory('Change ray opacity', 'ray-opacity');
    untickInherit();
    const v = parseFloat(e.target.value);
    get('rp-opacity-number').value = v.toFixed(2);
    currentComponent.rayPolygonOpacity = v;
    propagateColor(currentComponent, null, v, null, null);
    apply();
  });
  get('rp-opacity').addEventListener('change', commitControlHistory);

  get('rp-radius').addEventListener('input', e => {
    if (!currentComponent) return;
    beginControlHistory('Change aperture radius', 'aperture-radius');
    const v = parseFloat(e.target.value);
    get('rp-radius-number').value = v;
    currentComponent.setApertureRadius(v);
    apply();
  });
  get('rp-radius').addEventListener('change', commitControlHistory);

  get('rp-offset').addEventListener('input', e => {
    if (!currentComponent) return;
    beginControlHistory('Change aperture offset', 'aperture-offset');
    const v = parseFloat(e.target.value);
    get('rp-offset-number').value = v;
    currentComponent.setApertureCenterOffset(v);
    apply();
  });
  get('rp-offset').addEventListener('change', commitControlHistory);

  get('rp-segments').addEventListener('change', e => {
    actionHistory.run('Change array segments', 'array-segments', () => {
      if (!currentComponent) return;
      currentComponent.setArraySegments(parseInt(e.target.value));
      apply();
    });
  });

  get('rp-size-ratio').addEventListener('input', e => {
    if (!currentComponent) return;
    beginControlHistory('Change array size', 'array-size-ratio');
    const v = parseFloat(e.target.value);
    get('rp-size-ratio-number').value = v.toFixed(2);
    currentComponent.setArraySizeRatio(v);
    apply();
  });
  get('rp-size-ratio').addEventListener('change', commitControlHistory);

  get('rp-position-ratio').addEventListener('input', e => {
    if (!currentComponent) return;
    beginControlHistory('Change array position', 'array-position-ratio');
    const v = parseFloat(e.target.value);
    get('rp-position-ratio-number').value = v.toFixed(2);
    currentComponent.setArrayPositionRatio(v);
    apply();
  });
  get('rp-position-ratio').addEventListener('change', commitControlHistory);

  const bindNumberToSlider = (numberId, sliderId, label, historyType, applyValue) => {
    const number = get(numberId);
    const slider = get(sliderId);
    if (!number || !slider) return;
    number.addEventListener('input', () => {
      let value = parseFloat(number.value);
      if (!Number.isFinite(value)) return;
      value = Math.max(parseFloat(number.min), Math.min(parseFloat(number.max), value));
      slider.value = value;
      syncSliderProgress(slider);
      beginControlHistory(label, historyType);
      applyValue(value);
      apply();
    });
    number.addEventListener('change', commitControlHistory);
  };
  bindNumberToSlider('rp-opacity-number', 'rp-opacity', 'Set ray opacity', 'ray-opacity', value => {
    untickInherit(); currentComponent.rayPolygonOpacity = value;
  });
  bindNumberToSlider('rp-radius-number', 'rp-radius', 'Set aperture radius', 'aperture-radius', value => currentComponent.setApertureRadius(value));
  bindNumberToSlider('rp-offset-number', 'rp-offset', 'Set aperture offset', 'aperture-offset', value => currentComponent.setApertureCenterOffset(value));
  bindNumberToSlider('rp-size-ratio-number', 'rp-size-ratio', 'Set array size', 'array-size-ratio', value => currentComponent.setArraySizeRatio(value));
  bindNumberToSlider('rp-position-ratio-number', 'rp-position-ratio', 'Set array position', 'array-position-ratio', value => currentComponent.setArrayPositionRatio(value));
}

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Call once during app init. Renders blank state and registers selection hook.
 */
export function setupRayMenu() {
  const body = document.getElementById('ray-panel-body');
  if (!body) return;

  body.innerHTML = EMPTY_HTML;

  ComponentManager.onSelectionChanged = (component) => {
    currentBaseComponent = component;
    if (!component) {
      currentComponent = null;
      currentParentId = null;
      currentRayChild = null;
      currentConnectionKey = null;
      body.innerHTML = EMPTY_HTML;
      return;
    }
    const connections = getRayConnections(component);
    const connection = connections.find(candidate => candidate.key === currentConnectionKey) || connections[0] || null;
    selectRayConnection(connection);
    body.innerHTML = buildPanelHTML(currentComponent);
    wireEvents(body);
  };
}
