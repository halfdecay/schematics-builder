import { componentManager } from '../components/ComponentManager.js';

// Trace line settings
export let showTraceLines = true;

function createConnectionView(component, parentId) {
    const view = Object.create(Object.getPrototypeOf(component));
    Object.assign(view, component, component.getRayConfig(parentId));
    view.aperturePoints = view._getAperturePoints();
    return view;
}

// Draw trace lines connecting all parent-child relationships in the scene
export function drawTraceLines() {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    
    // Create trace lines group if it doesn't exist
    let traceLinesGroup = document.getElementById("trace-lines-group");
    if (!traceLinesGroup) {
        traceLinesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        traceLinesGroup.setAttribute("id", "trace-lines-group");
        
        // Insert before components so they appear behind
        const componentsGroup = document.getElementById("schematics"); // or components group
        if (componentsGroup) {
             canvas.insertBefore(traceLinesGroup, componentsGroup);
        } else {
             canvas.appendChild(traceLinesGroup);
        }
    }
    
    // Clear existing trace lines
    while (traceLinesGroup.firstChild) {
        traceLinesGroup.removeChild(traceLinesGroup.firstChild);
    }
    
    if (!showTraceLines) return;
    
    // Iterate through all components
    componentManager.components.forEach((component, componentId) => {
      const parentIds = [component.parent, ...(component.additionalParents || [])]
        .filter(id => id !== null);
      parentIds.forEach(parentId => {
        const rawParent = componentManager.getComponent(parentId);
        if (!rawParent) return;
        const sameCompositeInstance = component.isCompositeInstance &&
            rawParent.isCompositeInstance &&
            component.compositeInstanceId === rawParent.compositeInstanceId;
        const parentComponent = sameCompositeInstance
            ? rawParent
            : componentManager.getCompositeExitPort(rawParent);
        if (!parentComponent) return;

        // The polygon is rendered from the per-connection view as well. Using
        // the same view here keeps the dashed optical axis attached when this
        // particular ray has its own aperture-center offset.
        const childView = createConnectionView(component, parentId);
        
        // Get aperture centers in world space
        const childCenter = childView.getApertureCenterWorld();
        const parentCenter = parentComponent.getApertureCenterWorld();
        
        // Draw black dotted line between aperture centers
        const traceLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        traceLine.setAttribute("x1", parentCenter.x);
        traceLine.setAttribute("y1", parentCenter.y);
        traceLine.setAttribute("x2", childCenter.x);
        traceLine.setAttribute("y2", childCenter.y);
        traceLine.setAttribute("stroke", "black");
        traceLine.setAttribute("stroke-width", "1");
        traceLine.setAttribute("stroke-dasharray", "5,5");
        traceLine.setAttribute("pointer-events", "none");
        traceLine.dataset.childId = String(componentId);
        traceLine.dataset.parentId = String(parentId);
        traceLinesGroup.appendChild(traceLine);
      });
    });
}

export function hideTraceLines() {
    const traceLinesGroup = document.getElementById("trace-lines-group");
    if (traceLinesGroup) {
        // Clear children
         while (traceLinesGroup.firstChild) {
            traceLinesGroup.removeChild(traceLinesGroup.firstChild);
        }
    }
}

// Toggle trace lines
export function toggleTraceLines() {
    showTraceLines = !showTraceLines;
    const traceBtn = document.getElementById('trace-btn');
    
    if (showTraceLines) {
        drawTraceLines();
        traceBtn.textContent = 'Trace On';
    } else {
        hideTraceLines();
        traceBtn.textContent = 'Trace Off';
    }
}

// Update trace lines if they are currently visible
export function updateTraceLines() {
    if (showTraceLines) {
        drawTraceLines();
    }
}
