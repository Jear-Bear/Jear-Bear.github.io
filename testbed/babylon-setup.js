// Initialize Babylon.js
const canvas = document.getElementById('highResCanvas');
const engine = new BABYLON.Engine(canvas, true);
const babylonScene = new BABYLON.Scene(engine);

// Set the scene background color to transparent (or a color of your choice)
babylonScene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // Transparent background

// Create a 2D disc (circle) with a small diameter
const circle = BABYLON.MeshBuilder.CreateDisc("circle", { radius: 1, tessellation: 32 }, babylonScene);
circle.position.y = 0; // Center the circle vertically

// Create an orthographic camera for a 2D view
const orthographicCamera = new BABYLON.FreeCamera("orthographicCamera", new BABYLON.Vector3(0, 0, -10), babylonScene);
orthographicCamera.setTarget(BABYLON.Vector3.Zero());
orthographicCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

// Function to update the camera's orthographic properties based on canvas size
function updateCamera() {
    const aspectRatio = canvas.width / canvas.height;
    orthographicCamera.orthoTop = 1; // Adjust these values based on desired circle size
    orthographicCamera.orthoBottom = -1;
    orthographicCamera.orthoLeft = -1 * aspectRatio;
    orthographicCamera.orthoRight = 1 * aspectRatio;
}

// Call updateCamera once to set the initial parameters
updateCamera();
orthographicCamera.attachControl(canvas, true);

// Create a light
const hemisphericLight = new BABYLON.HemisphericLight("hemisphericLight", new BABYLON.Vector3(0, 1, 0), babylonScene);

// Render loop
engine.runRenderLoop(() => {
    babylonScene.render();
});

// Resize event handler
window.addEventListener('resize', () => {
    engine.resize();
    updateCamera(); // Update camera when resizing
});
