/**
 * ApertureRays.js — Ray polygon rendering for all 5 aperture shapes.
 * 
 * Draws SVG polygons connecting parent-child component apertures based on ray shapes.
 * Supports all combinations: collimated, divergent, convergent, manual, and array modes.
 */

import { componentManager } from '../components/ComponentManager.js';
import { DEFAULT_SOLID_RAY_COLOR, DEFAULT_RAY_POLYGON_OPACITY } from '../config.js';
import { calculateProjections } from './ApertureScaling.js';
import { hexToRgb, rgbToHsl } from '../utils/colorUtils.js';

// Ray visibility settings
export let showApertureRays = true;
export let rayDisplayMode = 'solid'; // 'solid' | 'both' | 'none'

/**
 * Draw aperture rays connecting all parent-child component relationships.
 * Dispatches to the appropriate polygon function based on ray shapes.
 */
export function drawApertureRays() {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    
    // Remove existing aperture rays
    hideApertureRays();

    // Get or create <defs> in the SVG for gradient definitions
    let defs = canvas.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        canvas.insertBefore(defs, canvas.firstChild);
    }
    // Remove stale ray gradient definitions from the previous draw
    defs.querySelectorAll('[id^="ray-grad-"]').forEach(el => el.remove());

    // Create aperture rays group
    const rayGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    rayGroup.setAttribute("id", "aperture-rays");
    
    if (rayDisplayMode === 'none') return;

    // Iterate through all components with parents
    componentManager.components.forEach((child, childKey) => {
      const parentIds = [child.parent, ...(child.additionalParents || [])]
        .filter(id => id !== null);
      parentIds.forEach((parentId, connectionIndex) => {
        const rawParent = componentManager.getComponent(parentId);
        if (!rawParent) return;
        // Remap to the composite exit port only when the parent is a composite member
        // from a DIFFERENT instance than the child. Within the same composite, the
        // internal parent pointer must be used as-is (entry → exit wiring is internal).
        const sameCompositeInstance = child.isCompositeInstance &&
            rawParent.isCompositeInstance &&
            child.compositeInstanceId === rawParent.compositeInstanceId;
        const parent = sameCompositeInstance
            ? rawParent
            : componentManager.getCompositeExitPort(rawParent);
        if (!parent) return;

        // Create SVG gradient def if gradient mode is on; returns gradient ID or null
        const rayChild = _createConnectionView(child, parentId);
        const gradientId = rayChild.rayGradientEnabled
            ? _createGradientDef(defs, parent, rayChild, connectionIndex)
            : null;
        
        // Dispatch to appropriate rendering function based on child's ray shape
        // and parent's ray shape (for array mode decision)
        const polygons = getPolygonsForConnection(parent, rayChild, gradientId);
        
        polygons.forEach(polygon => {
            polygon.dataset.childId = childKey; // Map key (integer) matches selectedIds/children
            polygon.dataset.parentId = parentId;
            rayGroup.appendChild(polygon);
            if (rayDisplayMode === 'both') {
                _createEdgeLinesFromPolygon(polygon).forEach(line => rayGroup.appendChild(line));
            }
        });
      });
    });
    
    // Insert aperture rays before trace-lines-group (or schematics) so traces appear on top of rays
    const traceLinesGroup = document.getElementById("trace-lines-group");
    const schematicsGroup = document.getElementById("schematics");
    const insertBefore = traceLinesGroup || schematicsGroup;
    if (insertBefore) {
        canvas.insertBefore(rayGroup, insertBefore);
    } else {
        canvas.appendChild(rayGroup);
    }
}

function _createConnectionView(child, parentId) {
    const view = Object.create(Object.getPrototypeOf(child));
    Object.assign(view, child, child.getRayConfig(parentId));
    view._baseComponent = child;
    view.aperturePoints = view._getAperturePoints();
    return view;
}

function _getFixedConnectionPerpendicular(parent, child) {
    const parentCenter = parent.getApertureCenterWorld();
    const childCenter = child.getApertureCenterWorld();
    const dx = childCenter.x - parentCenter.x;
    const dy = childCenter.y - parentCenter.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;

    let x = -dy / length;
    let y = dx / length;

    // Preserve the component's upper/lower ordering so ray colors and the
    // optional edge flip remain predictable when switching modes.
    const radians = child.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const globalUpX = child.upVector.x * cos - child.upVector.y * sin;
    const globalUpY = child.upVector.x * sin + child.upVector.y * cos;
    if (globalUpX * x + globalUpY * y < 0) {
        x = -x;
        y = -y;
    }
    return { x, y };
}

function _createFixedApertureView(component, perpendicular) {
    const view = Object.create(component);

    view.getAperturePointsWorld = () => {
        const center = component.getApertureCenterWorld();
        const localCenter = component._getEffectiveApertureCenter();
        return component._getAperturePoints().map(point => {
            const offset = (point.x - localCenter.x) * component.upVector.x +
                (point.y - localCenter.y) * component.upVector.y;
            return {
                x: center.x + perpendicular.x * offset,
                y: center.y + perpendicular.y * offset
            };
        });
    };

    view.getApertureFullExtentWorld = () => {
        const center = component.getApertureCenterWorld();
        const radius = component.apertureRadius;
        return [
            { x: center.x + perpendicular.x * radius, y: center.y + perpendicular.y * radius },
            { x: center.x - perpendicular.x * radius, y: center.y - perpendicular.y * radius }
        ];
    };

    return view;
}

function _createClippedBeamView(component, perpendicular, radius) {
    const view = Object.create(component);
    view.apertureRadius = radius;
    view.getAperturePointsWorld = () => {
        const center = component.getApertureCenterWorld();
        const radians = component.rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const upX = component.upVector.x * cos - component.upVector.y * sin;
        const upY = component.upVector.x * sin + component.upVector.y * cos;
        const projection = upX * perpendicular.x + upY * perpendicular.y;
        if (Math.abs(projection) < 1e-9) return [center, center];
        const distanceOnPlane = radius / projection;
        return [
            { x: center.x + upX * distanceOnPlane, y: center.y + upY * distanceOnPlane },
            { x: center.x - upX * distanceOnPlane, y: center.y - upY * distanceOnPlane }
        ];
    };
    view.getApertureFullExtentWorld = view.getAperturePointsWorld;
    return view;
}

function _resolveRayParent(component) {
    if (component.parent == null) return null;
    const rawParent = componentManager.getComponent(component.parent);
    if (!rawParent) return null;
    const sameCompositeInstance = component.isCompositeInstance &&
        rawParent.isCompositeInstance &&
        component.compositeInstanceId === rawParent.compositeInstanceId;
    return sameCompositeInstance ? rawParent : componentManager.getCompositeExitPort(rawParent);
}

function _projectedClearRadius(component, other) {
    const projections = calculateProjections(component, other);
    return projections?.child.apertureProjection ?? 0;
}

/**
 * Width leaving component in the direction of `next`.
 *
 * The incoming beam width is propagated unchanged through collimated links.
 * The component can only reduce it when its projected clear aperture is
 * smaller; a large optic never expands or contracts a narrower beam.
 */
function _getOutgoingCollimatedWidth(component, next, visited = new Set()) {
    if (visited.has(component)) return _projectedClearRadius(component, next);
    visited.add(component);

    const outgoingCapacity = _projectedClearRadius(component, next);
    const previous = _resolveRayParent(component);
    if (!previous) return outgoingCapacity;

    const incomingConfig = component.getRayConfig?.(component.parent);
    if (incomingConfig?.rayShape !== 'aperture-clipped') return outgoingCapacity;

    const configuredWidth = Number.isFinite(incomingConfig.apertureRadius)
        ? incomingConfig.apertureRadius
        : Infinity;
    const incomingWidth = Math.min(
        _getOutgoingCollimatedWidth(previous, component, visited),
        configuredWidth
    );
    const incomingCapacity = _projectedClearRadius(component, previous);
    const widthAtComponent = Math.min(incomingWidth, incomingCapacity);
    return Math.min(widthAtComponent, outgoingCapacity);
}

function _createRayGeometryViews(parent, child) {
    const perpendicular = _getFixedConnectionPerpendicular(parent, child);
    if (!perpendicular) return { parent, child };

    if (child.rayShape === 'aperture-clipped') {
        const baseChild = child._baseComponent || child;
        const configuredWidth = Number.isFinite(child.apertureRadius)
            ? child.apertureRadius
            : Infinity;
        const startRadius = Math.min(
            _getOutgoingCollimatedWidth(parent, baseChild),
            configuredWidth
        );
        const endRadius = Math.min(startRadius, _projectedClearRadius(baseChild, parent));
        if (startRadius > 0 && endRadius > 0) {
            return {
                parent: _createClippedBeamView(parent, perpendicular, startRadius),
                child: _createClippedBeamView(child, perpendicular, endRadius)
            };
        }
        return { parent, child };
    }

    if (child.rayWidthMode !== 'fixed') return { parent, child };
    return {
        parent: _createFixedApertureView(parent, perpendicular),
        child: _createFixedApertureView(child, perpendicular)
    };
}

/**
 * Determine which polygon(s) to draw for a parent-child connection.
 * Returns an array of SVG polygon elements.
 * 
 * Dispatches based on child.rayShape with special handling for array mode
 * depending on whether parent is also array mode.
 *
 * Exported so the composite preview dialog can reuse identical ray geometry.
 */
export function getPolygonsForConnection(parent, child, gradientId = null) {
    ({ parent, child } = _createRayGeometryViews(parent, child));
    const polygons = [];
    
    switch (child.rayShape) {
        case 'collimated':
            const collimated = _createCollimatedPolygon(parent, child, gradientId);
            if (collimated) polygons.push(collimated);
            break;
        case 'aperture-clipped':
            const apertureClipped = _createCollimatedPolygon(parent, child, gradientId);
            if (apertureClipped) polygons.push(apertureClipped);
            break;
        case 'divergent':
            const divergent = _createDivergentPolygon(parent, child, gradientId);
            if (divergent) polygons.push(divergent);
            break;
        case 'convergent':
            const convergent = _createConvergentPolygon(parent, child, gradientId);
            if (convergent) polygons.push(convergent);
            break;
        case 'manual':
            const manual = _createManualPolygon(parent, child, gradientId);
            if (manual) polygons.push(manual);
            break;
        case 'array':
            if (parent.rayShape === 'array') {
                // Parent is array, child is array: center-aligned segment-to-segment connections
                _createArrayToArrayPolygons(parent, child, polygons, gradientId);
            } else {
                // Parent is non-array (collimated/divergent/convergent/manual), child is array:
                // treat child as manual — connect parent upper/lower to child full extent
                const arrayAsManual = _createArrayAsManualPolygon(parent, child, gradientId);
                if (arrayAsManual) polygons.push(arrayAsManual);
            }
            break;
    }
    
    return polygons;
}

// ─── Polygon creation functions ─────────────────────────────────────────────

/**
 * Return the upper and lower world-space extent of a parent's aperture.
 * For array parents, uses the full ±radius boundary (ignoring sub-segment size),
 * so the extent is always at ±apertureRadius regardless of arraySizeRatio.
 * For all other shapes the two values equal pts[0]/pts[1].
 */
function _getParentExtentWorld(parent) {
    if (parent.rayShape === 'array') {
        const [upper, lower] = parent.getApertureFullExtentWorld();
        return { upper, lower };
    }
    const pts = parent.getAperturePointsWorld();
    if (!pts || pts.length < 2) return null;
    return { upper: pts[0], lower: pts[pts.length - 1] };
}

function _getChildPointsWorld(child) {
    const points = child.getAperturePointsWorld();
    return child.rayFlip ? [...points].reverse() : points;
}

function _getChildFullExtentWorld(child) {
    const points = child.getApertureFullExtentWorld();
    return child.rayFlip ? [...points].reverse() : points;
}

/**
 * Collimated: 4-vertex polygon [parentUpper, childUpper, childLower, parentLower]
 */
function _createCollimatedPolygon(parent, child, gradientId = null) {
    const parentExtent = _getParentExtentWorld(parent);
    const childPts = _getChildPointsWorld(child);
    
    if (!parentExtent || !childPts || childPts.length < 2) {
        return null;
    }
    
    const parentUpper = parentExtent.upper;
    const parentLower = parentExtent.lower;
    const childUpper = childPts[0];
    const childLower = childPts[1];
    
    child.coneAngle = 0;
    return _createPolygonElement(
        [parentUpper, childUpper, childLower, parentLower],
        child,
        gradientId
    );
}

/**
 * Divergent: 3-vertex polygon [parentCenter, childUpper, childLower]
 * coneAngle logic:
 *   - If parent.coneAngle != 0: inherit it, recalculate child aperture radius
 *     from the axis distance so the beam expands at the same angle.
 *   - If parent.coneAngle == 0: keep child aperture radius, derive and assign
 *     coneAngle = atan(childRadius / axisDistance).
 */
function _createDivergentPolygon(parent, child, gradientId = null) {
    const parentCenter = parent.getApertureCenterWorld();
    const childCenter  = child.getApertureCenterWorld();

    // Axis distance between the two aperture centres
    const dx   = childCenter.x - parentCenter.x;
    const dy   = childCenter.y - parentCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1e-6) {
        if (parent.coneAngle && parent.coneAngle !== 0) {
            // Inherit parent cone angle; recalculate child aperture radius
            child.coneAngle = parent.coneAngle;
            const newRadius = dist * Math.tan(parent.coneAngle * Math.PI / 180);
            child.setApertureRadius(parseFloat(newRadius.toFixed(2)));
        } else {
            // Keep child aperture radius; derive its cone angle
            const halfAngleDeg = Math.atan2(child.apertureRadius, dist) * 180 / Math.PI;
            child.coneAngle = parseFloat(halfAngleDeg.toFixed(2));
        }
    }

    // Re-fetch aperture points after potential radius change
    const childPts = _getChildPointsWorld(child);
    if (!childPts || childPts.length < 2) return null;

    const childUpper = childPts[0];
    const childLower = childPts[1];

    return _createPolygonElement(
        [parentCenter, childUpper, childLower],
        child,
        gradientId
    );
}

/**
 * Convergent: 3-vertex polygon [parentUpper, childCenter, parentLower]
 * Also calculates and assigns child.coneAngle from the geometry.
 */
function _createConvergentPolygon(parent, child, gradientId = null) {
    const parentExtent = _getParentExtentWorld(parent);
    const childCenter = child.getApertureCenterWorld();
    
    if (!parentExtent) {
        return null;
    }
    
    const parentUpper = parentExtent.upper;
    const parentLower = parentExtent.lower;

    // Compute cone half-angle: angle at childCenter between axis and edge ray.
    // Axis = childCenter → parentCenter (midpoint of parentUpper/parentLower).
    const parentCenterW = parent.getApertureCenterWorld();
    const axDx = parentCenterW.x - childCenter.x;
    const axDy = parentCenterW.y - childCenter.y;
    const axLen = Math.sqrt(axDx * axDx + axDy * axDy);
    if (axLen > 1e-6) {
        // Edge ray: childCenter → parentUpper
        const edDx = parentUpper.x - childCenter.x;
        const edDy = parentUpper.y - childCenter.y;
        const edLen = Math.sqrt(edDx * edDx + edDy * edDy);
        // cos(θ) = dot(axis, edge) / (|axis| * |edge|)
        const dot = axDx * edDx + axDy * edDy;
        const cosAngle = Math.min(1, Math.max(-1, dot / (axLen * edLen)));
        const halfAngleDeg = Math.acos(cosAngle) * 180 / Math.PI;
        child.coneAngle = parseFloat(halfAngleDeg.toFixed(2));
    }
    
    return _createPolygonElement(
        [parentUpper, childCenter, parentLower],
        child,
        gradientId
    );
}

/**
 * Manual: 4-vertex polygon [parentUpper, childUpper, childLower, parentLower]
 * Same geometry as collimated, but semantically different (no auto-scaling).
 */
function _createManualPolygon(parent, child, gradientId = null) {
    return _createCollimatedPolygon(parent, child, gradientId);
}

/**
 * Array as manual: single 4-vertex polygon spanning the full child aperture extent.
 * Uses child's first point (top of first segment) and last point (bottom of last segment).
 * [parentUpper, childTop, childBottom, parentLower]
 */
function _createArrayAsManualPolygon(parent, child, gradientId = null) {
    const parentPts = parent.getAperturePointsWorld();
    // Use full ±radius extent for the child (not sub-segment endpoints)
    const childExtent = _getChildFullExtentWorld(child);

    if (!parentPts || parentPts.length < 2 || !childExtent) {
        return null;
    }

    const parentUpper = parentPts[0];
    const parentLower = parentPts[parentPts.length - 1];
    const [childTop, childBottom] = childExtent;

    return _createPolygonElement(
        [parentUpper, childTop, childBottom, parentLower],
        child,
        gradientId
    );
}

/**
 * Array-to-Array: Multiple 4-vertex polygons, one per matching segment pair.
 * [parentSegTop[i], childSegTop[i], childSegBot[i], parentSegBot[i]]
 * Uses center-aligned pairing: if counts differ, the center segments are connected
 * and the outer ones on the side with more segments are ignored.
 */
function _createArrayToArrayPolygons(parent, child, polygons, gradientId = null) {
    const parentPts = parent.getAperturePointsWorld();
    const childPts = _getChildPointsWorld(child);
    
    if (!parentPts || !childPts) return;
    
    // Determine number of matching segment pairs (center-aligned)
    const n = Math.min(parent.arraySegments, child.arraySegments);
    const parentOffset = Math.floor((parent.arraySegments - n) / 2);
    const childOffset  = Math.floor((child.arraySegments  - n) / 2);
    
    // Each segment has 2 points (top, bot), so segment i uses indices [2i, 2i+1]
    for (let i = 0; i < n; i++) {
        const parentSegTopIdx = (parentOffset + i) * 2;
        const parentSegBotIdx = (parentOffset + i) * 2 + 1;
        const childSegTopIdx  = (childOffset  + i) * 2;
        const childSegBotIdx  = (childOffset  + i) * 2 + 1;
        
        if (parentSegTopIdx >= parentPts.length || parentSegBotIdx >= parentPts.length ||
            childSegTopIdx >= childPts.length || childSegBotIdx >= childPts.length) {
            break;
        }
        
        const polygon = _createPolygonElement(
            [
                parentPts[parentSegTopIdx],  // parentSegTop[i]
                childPts[childSegTopIdx],    // childSegTop[i]
                childPts[childSegBotIdx],    // childSegBot[i]
                parentPts[parentSegBotIdx]   // parentSegBot[i]
            ],
            child,
            gradientId
        );
        
        if (polygon) {
            polygons.push(polygon);
        }
    }
}

// ─── Gradient helpers ────────────────────────────────────────────────────────

/**
 * Parse a color string (hsl(h,s%,l%) or hex) to {h, s, l} with s and l in 0–100.
 */
function _colorToHSL(colorStr) {
    const hslMatch = colorStr && colorStr.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
    if (hslMatch) {
        return { h: parseFloat(hslMatch[1]), s: parseFloat(hslMatch[2]), l: parseFloat(hslMatch[3]) };
    }
    const rgb = hexToRgb(colorStr || '');
    if (rgb) return rgbToHsl(rgb.r, rgb.g, rgb.b);
    return { h: 0, s: 70, l: 50 };
}

/**
 * Create an SVG <linearGradient> element in the given <defs> for a parent→child connection.
 * The gradient runs perpendicular to the center-to-center line (trace line), oriented so
 * that x1,y1 is always the upper aperture side (child upVector direction) → knob1 color,
 * and x2,y2 is the lower side → knob2 color.
 * Returns the gradient ID string, or null if the gradient cannot be computed.
 */
function _createGradientDef(defs, parent, child, connectionIndex = 0) {
    const gradientId = `ray-grad-${child.id}-${connectionIndex}`;

    // Center-to-center direction
    const childCenter  = child.getCenterPointWorld();
    const parentCenter = parent.getCenterPointWorld();
    const dx = childCenter.x - parentCenter.x;
    const dy = childCenter.y - parentCenter.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return null;

    // Raw perpendicular: 90° CCW rotation of center line unit vector
    const rawPerpX = -dy / len;
    const rawPerpY =  dx / len;

    // Orient perpendicular to align with child's world-space upVector
    // so that the positive perp direction always points "up"
    const rad = child.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const childGlobalUpX = child.upVector.x * cos - child.upVector.y * sin;
    const childGlobalUpY = child.upVector.x * sin + child.upVector.y * cos;
    const dot = childGlobalUpX * rawPerpX + childGlobalUpY * rawPerpY;
    const upPerpX = dot >= 0 ? rawPerpX : -rawPerpX;
    const upPerpY = dot >= 0 ? rawPerpY : -rawPerpY;

    // Half-extent = max of parent and child aperture projections onto perpendicular
    const projections = child.rayWidthMode === 'fixed' ? null : calculateProjections(child, parent);
    const halfExtent = child.rayWidthMode === 'fixed'
        ? Math.max(parent.apertureRadius, child.apertureRadius)
        : (projections
            ? Math.max(projections.parent.apertureProjection, projections.child.apertureProjection)
            : child.apertureRadius);
    if (halfExtent < 1e-6) return null;

    // Gradient center at child aperture center (accounts for apertureCenterOffset)
    const gradCenter = child.getApertureCenterWorld();
    const x1 = gradCenter.x + upPerpX * halfExtent;  // upper → knob1 (color1)
    const y1 = gradCenter.y + upPerpY * halfExtent;
    const x2 = gradCenter.x - upPerpX * halfExtent;  // lower → knob2 (color2)
    const y2 = gradCenter.y - upPerpY * halfExtent;

    // Build the linearGradient element
    const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient.setAttribute("id", gradientId);
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient.setAttribute("x1", x1);
    gradient.setAttribute("y1", y1);
    gradient.setAttribute("x2", x2);
    gradient.setAttribute("y2", y2);

    // Parse colors and compute averaged saturation/lightness for the 5-stop hue interpolation
    const hsl1 = _colorToHSL(child.rayPolygonColor  || DEFAULT_SOLID_RAY_COLOR);
    const hsl2 = _colorToHSL(child.rayPolygonColor2 || child.rayPolygonColor || DEFAULT_SOLID_RAY_COLOR);
    const avgS = (hsl1.s + hsl2.s) / 2;
    const avgL = (hsl1.l + hsl2.l) / 2;
    const opacity = child.rayPolygonOpacity ?? DEFAULT_RAY_POLYGON_OPACITY;

    for (let i = 0; i < 5; i++) {
        const t = i / 4;
        let h = hsl1.h + (hsl2.h - hsl1.h) * t;
        h = ((h % 360) + 360) % 360;
        const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stop.setAttribute("offset", `${t * 100}%`);
        stop.setAttribute("stop-color", `hsl(${Math.round(h)}, ${Math.round(avgS)}%, ${Math.round(avgL)}%)`);
        stop.setAttribute("stop-opacity", String(opacity));
        gradient.appendChild(stop);
    }

    defs.appendChild(gradient);
    return gradientId;
}

/**
 * Public helper: ensure `svgEl` has a <defs>, create a gradient for parent→child
 * in that defs, and return the gradient ID (or null if not applicable).
 * Used by external SVG builders (e.g. composite save dialog preview/snapshot).
 */
export function createRayGradientForSvg(svgEl, parent, child) {
    if (!child.rayGradientEnabled) return null;
    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svgEl.insertBefore(defs, svgEl.firstChild);
    }
    return _createGradientDef(defs, parent, child);
}

// ─── SVG polygon element creation ───────────────────────────────────────────

/**
 * Create an SVG polygon element with the given vertices and child's color/opacity.
 * Vertices should be an array of {x, y} objects.
 */
function _createPolygonElement(vertices, child, gradientId = null) {
    if (!vertices || vertices.length < 3) {
        return null;
    }
    
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    
    // Build points string: "x1,y1 x2,y2 x3,y3 ..."
    const pointsString = vertices
        .map(pt => `${pt.x},${pt.y}`)
        .join(" ");
    
    polygon.setAttribute("points", pointsString);
    if (gradientId) {
        // Gradient fill — opacity is embedded in the gradient stops
        polygon.setAttribute("fill", `url(#${gradientId})`);
        polygon.setAttribute("fill-opacity", "1");
    } else {
        polygon.setAttribute("fill", child.rayPolygonColor || DEFAULT_SOLID_RAY_COLOR);
        polygon.setAttribute("fill-opacity", child.rayPolygonOpacity ?? DEFAULT_RAY_POLYGON_OPACITY);
    }
    polygon.setAttribute("stroke", "none");
    polygon.setAttribute("pointer-events", "none");

    // Store edge endpoints for dotted edge line rendering ('both' mode)
    const last = vertices.length - 1;
    const e2start = (vertices.length === 3 && child.rayShape === 'divergent')
        ? vertices[0] : vertices[last];
    const e2end = (vertices.length === 3 && child.rayShape === 'divergent')
        ? vertices[2] : vertices[last - 1];
    polygon.dataset.edge1 = `${vertices[0].x},${vertices[0].y},${vertices[1].x},${vertices[1].y}`;
    polygon.dataset.edge2 = `${e2start.x},${e2start.y},${e2end.x},${e2end.y}`;

    return polygon;
}

function _createEdgeLinesFromPolygon(polygon) {
    const e1 = polygon.dataset.edge1;
    const e2 = polygon.dataset.edge2;
    if (!e1 || !e2) return [];

    return [e1, e2].map(coordStr => {
        const [x1, y1, x2, y2] = coordStr.split(',').map(Number);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", "#333");
        line.setAttribute("stroke-width", "1");
        line.setAttribute("stroke-dasharray", "4,3");
        line.setAttribute("pointer-events", "none");
        return line;
    });
}

// ─── Visibility controls ───────────────────────────────────────────────────

/**
 * Hide aperture rays by removing the group from the canvas.
 */
export function hideApertureRays() {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    
    const rayGroup = canvas.querySelector("#aperture-rays");
    if (rayGroup) {
        rayGroup.remove();
    }
}

/**
 * Toggle aperture rays visibility.
 */
export function toggleApertureRays() {
    const btn = document.getElementById('rays-toggle-btn');

    switch (rayDisplayMode) {
        case 'solid':
            rayDisplayMode = 'both';
            showApertureRays = true;
            if (btn) btn.textContent = 'Ray and Contour';
            drawApertureRays();
            break;
        case 'both':
            rayDisplayMode = 'none';
            showApertureRays = false;
            if (btn) btn.textContent = 'No Ray';
            hideApertureRays();
            break;
        case 'none':
            rayDisplayMode = 'solid';
            showApertureRays = true;
            if (btn) btn.textContent = 'Only Ray';
            drawApertureRays();
            break;
    }
}
