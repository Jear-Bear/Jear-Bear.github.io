pentagons = [];
jellies = [];
var clickX = 0.0;
var clickY = 0;
let clickStartTime;
let clickDuration;
var linkedin = new Image();
linkedin.src = "linkedin.png";
var git = new Image();
git.src = "github.png";
var image = new Image();
var youtube = new Image();
youtube.src = "youtube.png";
var instagram = new Image();
instagram.src = "instagram.png";
var text = new Image();
text.src = "text.png";

const rgbaColors = [
  [54, 74, 211],  
	[144, 204, 76, 1],    // Color 1: (144, 204, 76)
    [118, 205, 126, 1],    // Color 2: (238, 196, 79)
    [244, 93, 84, 1],     // Color 3: (244, 93, 84)
    [251, 130, 72, 1],    // Color 4: (243, 227, 71)
    [203, 71, 243, 1]     // Color 5: (203, 71, 243)
];


const simWidth = 16; // Example: 16 units wide
const simHeight = 9; // Example: 9 units high
const simAspectRatio = simWidth / simHeight;

var highResCanvas = document.getElementById('highResCanvas');

window.onload = function() {
    // After the window loads, update camera and mesh positions
    updateCamera(); // Call your updateCamera function to recalculate the aspect ratio
    updateMeshPositions(); // This can be a custom function to re-calculate mesh positions based on LiquidFun
};

// Function to update mesh positions based on pentagons array
function updateMeshPositions() {
    const aspectRatio = canvas.width / canvas.height;

    for (var i = 0; i < window.pentagons.length; i++) {
        var position = window.pentagons[i].GetPosition();
        var x = position.x;
        var y = position.y;

        // Adjust x positions by aspect ratio to align with Babylon.js
        var adjustedX = x / 5.6 / aspectRatio;  // Adjust x by aspect ratio
        var adjustedY = y / 5.6 - 0.72;

        switch (i) {
            case 0:
                circle1.position.x = adjustedX;
                circle1.position.y = adjustedY;
                break;
            case 1:
                circle2.position.x = adjustedX;
                circle2.position.y = adjustedY;
                break;
            case 2:
                circle3.position.x = adjustedX;
                circle3.position.y = adjustedY;
                break;
            case 3:
                circle4.position.x = adjustedX;
                circle4.position.y = adjustedY;
                break;
        }
    }
}

function initBabylon() {
    // Initialize Babylon.js
    const canvas = document.getElementById('highResCanvas');
    const engine = new BABYLON.Engine(canvas, true);
    const babylonScene = new BABYLON.Scene(engine);

    // Set the scene background color to transparent (or a color of your choice)
    babylonScene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // Transparent background

    // Create circles and apply the textures
    const pentagon1 = createPentagon("pentagon1", linkedin, babylonScene);
		const pentagon2 = createPentagon("pentagon2", git, babylonScene);
		const pentagon3 = createPentagon("pentagon3", youtube, babylonScene);
		const pentagon4 = createPentagon("pentagon4", instagram, babylonScene);

		//Create text plane
		const textPlane = createTexturedPlane("textPlane", text, babylonScene);
	
	
    // Create an orthographic camera for a 2D view
    const orthographicCamera = new BABYLON.FreeCamera("orthographicCamera", new BABYLON.Vector3(0, 0, -10), babylonScene);
    orthographicCamera.setTarget(BABYLON.Vector3.Zero());
    orthographicCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

    function updateCamera() {
    const aspectRatio = canvas.width / canvas.height;

    // Adjust orthographic bounds based on aspect ratio
    orthographicCamera.orthoTop = 1;
    orthographicCamera.orthoBottom = -1;
    orthographicCamera.orthoLeft = -1 * aspectRatio;  // Scale by aspect ratio
    orthographicCamera.orthoRight = 1 * aspectRatio;  // Scale by aspect ratio
		}

    // Function to update the camera's orthographic properties based on canvas size
    updateCamera();
    orthographicCamera.attachControl(canvas, true);

    // Create a light
    const hemisphericLight = new BABYLON.HemisphericLight("hemisphericLight", new BABYLON.Vector3(0, 1, 0), babylonScene);

		//set engine render resolution for better sprite accuracy
		engine.setHardwareScalingLevel(0.5);
	
		var inloop = false;
	
    // Render loop
		engine.runRenderLoop(() => {
    babylonScene.render();
			
		if (!inloop)
		{
			engine.resize();
			inloop = true;
		}
			
    for (var i = 0; i < window.pentagons.length; i++) {
        var position = window.pentagons[i].GetPosition(); // Get the corresponding pentagon position
        var angle = window.pentagons[i].GetAngle() - 12.9; // Get the angle of the physics body

        var x = position.x; // Access x coordinate
        var y = position.y; // Access y coordinate

        switch (i) {
            case 0:
                pentagon1.position.x = x / 5.6;
                pentagon1.position.y = y / 5.6 - 0.72;
                pentagon1.rotation.z = angle; // Update rotation
                break;
            case 1:
                pentagon2.position.x = x / 5.6;
                pentagon2.position.y = y / 5.6 - 0.72;
                pentagon2.rotation.z = angle; // Update rotation
                break;
            case 2:
                pentagon3.position.x = x / 5.6;
                pentagon3.position.y = y / 5.6 - 0.72;
                pentagon3.rotation.z = angle; // Update rotation
                break;
            case 3:
                pentagon4.position.x = x / 5.6;
                pentagon4.position.y = y / 5.6 - 0.72;
                pentagon4.rotation.z = angle; // Update rotation
                break;
        }
    }
});


    // Resize event handler
    window.addEventListener('resize', () => {
        engine.resize();
        updateCamera(); // Update camera when resizing
    });
	
	// Trigger the resize function initially to align everything
    window.dispatchEvent(new Event('resize'));
}

function createTexturedPlane(name, textureSrc, scene, engine) {
    // Create a texture from the image source with alpha support
    const texture = new BABYLON.Texture(textureSrc.src, scene);
    
    // Create a plane mesh with an initial size
    const plane = BABYLON.MeshBuilder.CreatePlane(name, { size: 1 }, scene);

    // Create a material and apply the texture
    const material = new BABYLON.StandardMaterial(name + "Material", scene);
    material.diffuseTexture = texture; // Assign the texture to the material
    
    // Set up the material to support transparency
    material.opacityTexture = texture; // Use the same texture for opacity
    material.diffuseTexture.hasAlpha = true; // Ensure the texture has an alpha channel
    material.alpha = 1; // Fully opaque; adjust if you want transparency
    material.backFaceCulling = false; // Disable back face culling to see both sides

    // Set the sampling mode for the texture to improve sharpness
    material.diffuseTexture.samplingMode = BABYLON.Texture.ANISOTROPIC_SAMPLINGMODE; // Use bilinear filtering for sharpness

    // Apply the material to the plane
    plane.material = material;

    // Position the plane in front of the camera
    plane.position = new BABYLON.Vector3(0, 0.277, 1); // Adjust as needed

    // Log texture loading
    texture.onLoadObservable.add(() => {
        console.log("Texture loaded successfully:", texture.getSize());

        // Adjust the scaling of the plane based on the texture size
        const textureWidth = texture.getSize().width;
        const textureHeight = texture.getSize().height;

        // Scale the plane to match the texture dimensions
        const scaleFactor = 0.00122; // Adjust this factor as needed to fit the scene
        plane.scaling.x = (textureWidth * scaleFactor); // Scale X based on texture width
        plane.scaling.y = (textureHeight * scaleFactor); // Scale Y based on texture height
    });
    return plane;
}

function createPentagon(name, textureSrc, scene, scale = 1.25) { // Added scale parameter
    const points = [];
    const radius = 0.137; // Adjust the radius as needed
    const angleOffset = Math.PI / 2; // Start angle

    // Define the vertices for the pentagon
    for (let i = 0; i < 5; i++) {
        const angle = angleOffset + (i * (2 * Math.PI / 5));
        points.push(new BABYLON.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }

    // Create an empty mesh
    const pentagon = new BABYLON.Mesh(name, scene);

    // Create the vertex data
    const vertexData = new BABYLON.VertexData();
    const positions = [];
    const indices = [];
    const uvs = []; // Array to hold UV coordinates

    // Center point for the triangles
    const center = new BABYLON.Vector3(0, 0, 0);

    // Create triangles by connecting the center point with each pair of consecutive points
    for (let i = 0; i < points.length; i++) {
        const nextIndex = (i + 1) % points.length; // Wrap around to form a loop

        // Center vertex
        positions.push(center.x, center.y, center.z); // Center vertex
        // Current vertex
        positions.push(points[i].x, points[i].y, points[i].z); // Current vertex
        // Next vertex
        positions.push(points[nextIndex].x, points[nextIndex].y, points[nextIndex].z); // Next vertex

        // Create indices for the triangles
        const baseIndex = i * 3; // Each triangle has 3 vertices
        indices.push(baseIndex, baseIndex + 1, baseIndex + 2);

        // UV Mapping (adjust for zoom)
        uvs.push(0.5, 0.5); // Center UV (for center vertex)

        // Calculate UV for each vertex and adjust for rotation (flip U and V)
        const uCurrent = 0.5 - (points[i].x / radius) * 0.5; // Flip horizontally
        const vCurrent = 0.5 + (points[i].y / radius) * 0.5; // Flip vertically
        const uNext = 0.5 - (points[nextIndex].x / radius) * 0.5;
        const vNext = 0.5 + (points[nextIndex].y / radius) * 0.5;

        uvs.push(uCurrent, vCurrent); // UV for current vertex
        uvs.push(uNext, vNext); // UV for next vertex
    }

    vertexData.positions = positions;
    vertexData.indices = indices;

    // Apply scale to the UVs to make the image larger
    for (let i = 0; i < uvs.length; i += 2) {
        uvs[i] = 0.5 + (uvs[i] - 0.5) / scale;   // Scale U coordinate
        uvs[i + 1] = 0.5 + (uvs[i + 1] - 0.5) / scale; // Scale V coordinate
    }

    // Move the image down by 0.1 pixels in the UV space
    const moveDown = -.003 / (radius * scale); // Adjust this value based on radius and scale
    for (let i = 0; i < uvs.length; i += 2) {
        uvs[i + 1] += moveDown; // Move V coordinate down
    }

    vertexData.uvs = uvs;

    // Apply vertex data to the mesh
    vertexData.applyToMesh(pentagon);

    // Create a texture from the image source
    const texture = new BABYLON.Texture(textureSrc.src, scene);

    const material = new BABYLON.StandardMaterial(name + "Material", scene);
    material.diffuseTexture = texture; // Set the texture
    material.diffuseColor = new BABYLON.Color3(1, 1, 1); // Set diffuse color to white
    material.emissiveColor = new BABYLON.Color3(1, 1, 1); // Set emissive color to white
    pentagon.material = material; // Apply the material

    // Adjust texture scaling to keep the original size for the texture
    material.diffuseTexture.uScale = 1; // Keep U scale as default
    material.diffuseTexture.vScale = 1; // Keep V scale as default

    return pentagon;
}

  let bd, ground, particleSystem;

function TestParticles() {
	console.log(window.innerWidth + ", " + window.innerHeight);
	document.getElementById('textCanvas').getContext("2d").scale(window.innerWidth/1386, window.innerHeight/818);
	camera.position.y = 4;
	camera.position.z = 8;
	bd = new b2BodyDef();
	ground = world.CreateBody(bd);  
		
	initBabylon();
	createLetterH();
	createLetterI();
	
	createComma();
	
	createUpperLetterI();
	createApostrophe();
	createM();
	
	createJ();
	createA();
	createR();
	createE();
	createD();
	
	createPeriod();
	
	createLine();
	
	var shape1 = new b2PolygonShape();
	var vertices = shape1.vertices;
	vertices.push(new b2Vec2(-20, -1.6));
	vertices.push(new b2Vec2(20, -1.6));
	vertices.push(new b2Vec2(20, -1.4));
	vertices.push(new b2Vec2(-20, -1.4));
	ground.CreateFixtureFromShape(shape1, 0);
	
	var shape2 = new b2PolygonShape();
	var vertices = shape2.vertices;
	vertices.push(new b2Vec2(-9.3, -1.4));
	vertices.push(new b2Vec2(-10, -1.4));
	vertices.push(new b2Vec2(-10, 9.4));
	vertices.push(new b2Vec2(-9.3, 9.4));
	ground.CreateFixtureFromShape(shape2, 0);
	
	var shape3 = new b2PolygonShape();
	var vertices = shape3.vertices;
	vertices.push(new b2Vec2(9.3, -1.4));
	vertices.push(new b2Vec2(10, -1.4));
	vertices.push(new b2Vec2(10, 9.4));
	vertices.push(new b2Vec2(9.3, 9.4));
	ground.CreateFixtureFromShape(shape3, 0);
	
	var shape4 = new b2PolygonShape();
	var vertices = shape4.vertices;
	vertices.push(new b2Vec2(-20, 10));
	vertices.push(new b2Vec2(20, 10));
	vertices.push(new b2Vec2(20, 9.4));
	vertices.push(new b2Vec2(-20, 9.4));
	ground.CreateFixtureFromShape(shape4, 0);
	
	var psd = new b2ParticleSystemDef();
	psd.radius = 0.0575;
	particleSystem = world.CreateParticleSystem(psd);
	
	// one group
	var circle = new b2CircleShape();
	circle.position.Set(0, 3);
	circle.radius = 2.1;
	var pgd = new b2ParticleGroupDef();
	pgd.shape = circle;
	pgd.color.Set(51, 197, 255, 255);
	particleSystem.CreateParticleGroup(pgd);
	
	var circle1 = new b2CircleShape();
	circle1.position.Set(-6, 3);
	circle1.radius = 2.1;
	var pgd1 = new b2ParticleGroupDef();
	pgd1.shape = circle1;
	pgd1.color.Set(51, 197, 255, 255);
	particleSystem.CreateParticleGroup(pgd1);
	
	var circle2 = new b2CircleShape();
	circle2.position.Set(6, 3);
	circle2.radius = 2.1;
	var pgd2 = new b2ParticleGroupDef();
	pgd2.shape = circle2;
	pgd2.color.Set(51, 197, 255, 255);
	particleSystem.CreateParticleGroup(pgd2);
	
	// Define a dynamic body
	bd = new b2BodyDef();
	bd.position.Set(-6, 0);
	bd.type = b2_dynamicBody;
	var body = world.CreateBody(bd);
	window.pentagons.push(body);
	
	bd1 = new b2BodyDef();
	bd1.position.Set(-2, 0);
	bd1.type = b2_dynamicBody;
	var body1 = world.CreateBody(bd1);
	window.pentagons.push(body1);
	
	bd2 = new b2BodyDef();
	bd2.position.Set(2, 0);
	bd2.type = b2_dynamicBody;
	var body2 = world.CreateBody(bd2);
	window.pentagons.push(body2);
	
	bd3 = new b2BodyDef();
	bd3.position.Set(6, 0);
	bd3.type = b2_dynamicBody;
	var body3 = world.CreateBody(bd3);
	window.pentagons.push(body3);
	
	// Create a pentagon shape
	var pentagon = new b2PolygonShape();
	var vertices = pentagon.vertices;
	
	// Define the vertices for a pentagon (5 sides)
	var angle = (2 * Math.PI) / 5; // 72 degrees for a regular pentagon
	for (var i = 0; i < 5; i++) {
	var x = .7 * Math.cos(i * angle); // 0.5 is the desired radius
	var y = .7 * Math.sin(i * angle);
	vertices.push(new b2Vec2(x, y));
	}
	
	// Create the fixture for the body using the pentagon shape
	body.CreateFixtureFromShape(pentagon, 0.5); // 0.5 is the density
	body1.CreateFixtureFromShape(pentagon, 0.5); // 0.5 is the density
	body2.CreateFixtureFromShape(pentagon, 0.5); // 0.5 is the density
	body3.CreateFixtureFromShape(pentagon, 0.5); // 0.5 is the density
	
	// Capture mouse click events and send coordinates to your JS file
	document.getElementById('canvas').addEventListener('click', function(event) {
	    const rectang = textCanvas.getBoundingClientRect();
	    const mouseTextX = event.clientX - rectang.left;
	    const mouseTextY = event.clientY - rectang.top;
	    
	    var i = 0;
	    
	    // Check if click is within any button area
	    buttonAreas.forEach(area => {
		if (mouseTextX >= area.x && mouseTextX <= area.x + area.width &&
		    mouseTextY >= area.y && mouseTextY <= area.y + area.height) {
		    switch(i)
		    {
			case 0:
			    window.location.href = "about_me.html";
			    break;
			case 1:
			    window.location.href = "blog.html";
			    break;
			case 2:
			    window.location.href = "projects.html";
			    break;
			case 3:
			    window.location.href = "contact.html";
			    break;
		    }
		    
		}
		i++
	    });
	    
	    var rect = this.getBoundingClientRect();
	    var mouseX = event.clientX - rect.left;
	    var mouseY = event.clientY - rect.top;
			
	    // Call your function with the mouse coordinates
	    handleMouseClick(mouseX, mouseY);
	});
	
	// Listen for the mousedown event (when the mouse button is pressed)
	document.getElementById('canvas').addEventListener('mousedown', function(event) {
	    if (event.button === 0) { // Check if it's the left mouse button (button === 0)
		clickStartTime = new Date().getTime(); // Record the time when the mouse button is pressed
	    }
	});
	
	// Listen for the mouseup event (when the mouse button is released)
	document.getElementById('canvas').addEventListener('mouseup', function(event) {
	    if (event.button === 0 && clickStartTime) { // Check if it's the left mouse button and if the click started
		const clickEndTime = new Date().getTime(); // Record the time when the mouse button is released
		clickDuration = clickEndTime - clickStartTime; // Calculate the duration
		clickStartTime = null; // Reset the click start time
	    }
	});
	
	// Function to handle mouse clicks and check for pentagon intersections
	function handleMouseClick(mouseX, mouseY) {
	// Example usage:
	clickX = ((mouseX - 695)/1360)*18.6;
	clickY = (((Math.abs(mouseY - 800) - 392.5)/789)*10.8 + 4);
	isClickInPolygon();
	}
	

	function getMouseCoords() {
	var mouse = new THREE.Vector3();
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	mouse.z = 0.5;
	
	projector.unprojectVector(mouse, camera);
	var dir = mouse.sub(camera.position).normalize();
	var distance = -camera.position.z / dir.z;
	var pos = camera.position.clone().add(dir.multiplyScalar(distance));
	var p = new b2Vec2(pos.x, pos.y);
	return p;
}
	
    // Function to print pentagon coordinates to console
    function isClickInPolygon()
    {
	let i = 0;
	
	while (i < pentagons.length)
	{
		// Assuming `pentagon` is a valid b2_dynamicBody object
		var position = pentagons[i].GetPosition(); // Call GetPosition() method to retrieve position
		var x = position.x; // Access x coordinate
		var y = position.y; // Access y coordinate			
		var coords = getMouseCoords();		
		var a = coords.x - x;
		var b = coords.y - y;			
		var c = Math.sqrt( a*a + b*b );
		
			if (c < .75 && clickDuration < 300)
			{
				switch(i)
				{
				    case 0:
					window.open("https://www.linkedin.com/in/jaredperlmutter/");
					break;
				    case 1:
					window.open("https://github.com/Jear-Bear");
					break;
				    case 2:
					window.open("https://www.youtube.com/@Jareddddddddddddddddd");
					break;
				    case 3:
					window.open("https://www.instagram.com/j_earbear/");
					break;
				}   
			}
		i++;
	}
    }

var width = window.innerWidth, height = window.innerHeight;
var widthHalf = width / 2, heightHalf = height / 2;
    
let SCALE_X = 73.1; // X scale factor
let SCALE_Y = 72.6; // Y scale factor
let rotationAdjustment = 17.5 * Math.PI / 180; // Convert 17.5 degrees to radians
const adjustmentX = 695; // Adjust this value if needed
const adjustmentY = -120; // Adjust this value if needed

var highResCanvas = document.getElementById('highResCanvas');
var highResContext = highResCanvas.getContext('2d');
var scaleFactor = 0.09; // Scale factor for image size

// Ensure highResCanvas dimensions match the viewport
highResCanvas.width = window.innerWidth;
highResCanvas.height = window.innerHeight;

// Get the text canvas and context
var textCanvas = document.getElementById('textCanvas');
var textContext = textCanvas.getContext('2d');

// Increase the canvas resolution
textCanvas.width = window.innerWidth * 2;  // Double the width
textCanvas.height = window.innerHeight * 2; // Double the height

// Scale down the drawing to fit the original canvas size
textContext.scale(2, 2);

// Store clickable areas for buttons
const buttonAreas = [];
	
function createLetterH() {
    // Create the left vertical bar of "H"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-3.22, 5.65));
    leftBarVertices.push(new b2Vec2(-3.22, 6.38));
    leftBarVertices.push(new b2Vec2(-3.16, 6.38));
    leftBarVertices.push(new b2Vec2(-3.16, 5.65));
    ground.CreateFixtureFromShape(leftBarShape, 0);

    // Create the right vertical bar of "H"
    var rightBarShape = new b2PolygonShape();
    var rightBarVertices = rightBarShape.vertices;
    rightBarVertices.push(new b2Vec2(-2.64, 5.65));
    rightBarVertices.push(new b2Vec2(-2.64, 6.38));
    rightBarVertices.push(new b2Vec2(-2.70, 6.38));
    rightBarVertices.push(new b2Vec2(-2.70, 5.65));
    ground.CreateFixtureFromShape(rightBarShape, 0);

    // Create the horizontal bar of "H"
    var horizontalBarShape = new b2PolygonShape();
    var horizontalBarVertices = horizontalBarShape.vertices;
    horizontalBarVertices.push(new b2Vec2(-3.11, 6.06));
    horizontalBarVertices.push(new b2Vec2(-3.11, 6));
    horizontalBarVertices.push(new b2Vec2(-2.70, 6));
    horizontalBarVertices.push(new b2Vec2(-2.70, 6.06));
    ground.CreateFixtureFromShape(horizontalBarShape, 0);
}
    
function createLetterI() {
    // Create the vertical bar of "i"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-2.44, 5.65));
    leftBarVertices.push(new b2Vec2(-2.44, 6.18));
    leftBarVertices.push(new b2Vec2(-2.38, 6.18));
    leftBarVertices.push(new b2Vec2(-2.38, 5.65));
    ground.CreateFixtureFromShape(leftBarShape, 0);

    // Create the dot of "i"
    var rightBarShape = new b2PolygonShape();
    var rightBarVertices = rightBarShape.vertices;
    rightBarVertices.push(new b2Vec2(-2.44, 6.38));
    rightBarVertices.push(new b2Vec2(-2.44, 6.28));
    rightBarVertices.push(new b2Vec2(-2.38, 6.28));
    rightBarVertices.push(new b2Vec2(-2.38, 6.38));
    ground.CreateFixtureFromShape(rightBarShape, 0);

}
    
function createComma() {
    // Create the comma dot
    var rightBarShape = new b2PolygonShape();
    var rightBarVertices = rightBarShape.vertices;
    rightBarVertices.push(new b2Vec2(-2.17, 5.65));
    rightBarVertices.push(new b2Vec2(-2.17, 5.76));
    rightBarVertices.push(new b2Vec2(-2.11, 5.76));
    rightBarVertices.push(new b2Vec2(-2.11, 5.65));
    ground.CreateFixtureFromShape(rightBarShape, 0);
    
    // Create the slant of the comma
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-2.19, 5.54));
    leftBarVertices.push(new b2Vec2(-2.12, 5.58))
    leftBarVertices.push(new b2Vec2(-2.1, 5.65));
    leftBarVertices.push(new b2Vec2(-2.06, 5.65));
    leftBarVertices.push(new b2Vec2(-2.13, 5.53));
    ground.CreateFixtureFromShape(leftBarShape, 0);
}

function createUpperLetterI() {
    // Create the uppercase "i"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-1.59, 5.65));
    leftBarVertices.push(new b2Vec2(-1.59, 6.38));
    leftBarVertices.push(new b2Vec2(-1.53, 6.38));
    leftBarVertices.push(new b2Vec2(-1.53, 5.65));
    ground.CreateFixtureFromShape(leftBarShape, 0);
}
    
function createApostrophe() {
    // Create the apostrophe
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-1.32, 6.15));
    leftBarVertices.push(new b2Vec2(-1.34, 6.38));
    leftBarVertices.push(new b2Vec2(-1.29, 6.38));
    leftBarVertices.push(new b2Vec2(-1.28, 6.15));
    ground.CreateFixtureFromShape(leftBarShape, 0);
}

function createM() {
    // Create the first vertical bar of "m"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(-1.1, 5.65));
    leftBarVertices.push(new b2Vec2(-1.1, 6.18));
    leftBarVertices.push(new b2Vec2(-1.04, 6.18));
    leftBarVertices.push(new b2Vec2(-1.04, 5.65));
    ground.CreateFixtureFromShape(leftBarShape, 0);

    // Create the second vertical bar of "m"
    var midBarShape = new b2PolygonShape();
    var midBarVertices = midBarShape.vertices;
    midBarVertices.push(new b2Vec2(-0.7, 5.65));
    midBarVertices.push(new b2Vec2(-0.7, 6.15));
    midBarVertices.push(new b2Vec2(-0.76, 6.15));
    midBarVertices.push(new b2Vec2(-0.76, 5.65));
    ground.CreateFixtureFromShape(midBarShape, 0);
    
    // Create the third vertical bar of "m"
    var rightBarShape = new b2PolygonShape();
    var rightBarVertices = rightBarShape.vertices;
    rightBarVertices.push(new b2Vec2(-0.39, 5.65));
    rightBarVertices.push(new b2Vec2(-0.39, 6.15));
    rightBarVertices.push(new b2Vec2(-0.33, 6.15));
    rightBarVertices.push(new b2Vec2(-0.33, 5.65));
    ground.CreateFixtureFromShape(rightBarShape, 0);
    
    // Create the slanted line between bars 1 and 2
    var firstSlope = new b2PolygonShape();
    var firstSlopeVertices = firstSlope.vertices;
    firstSlopeVertices.push(new b2Vec2(-1.04, 5.99));
    firstSlopeVertices.push(new b2Vec2(-1.04, 6.06));
    firstSlopeVertices.push(new b2Vec2(-.91, 6.13));
    firstSlopeVertices.push(new b2Vec2(-.84, 6.16));
    firstSlopeVertices.push(new b2Vec2(-.76, 6.15));
    firstSlopeVertices.push(new b2Vec2(-.76, 6.08));
    firstSlopeVertices.push(new b2Vec2(-.84, 6.14));
    ground.CreateFixtureFromShape(firstSlope, 0);
    
    // Create the slanted line between bars 2 and 3
    var secondSlope = new b2PolygonShape();
    var secondSlopeVertices = secondSlope.vertices;
    secondSlopeVertices.push(new b2Vec2(-.7, 5.99));
    secondSlopeVertices.push(new b2Vec2(-.7, 6.06));
    secondSlopeVertices.push(new b2Vec2(-.57, 6.13));
    secondSlopeVertices.push(new b2Vec2(-.47, 6.16));
    secondSlopeVertices.push(new b2Vec2(-.39, 6.15));
    secondSlopeVertices.push(new b2Vec2(-.39, 6.08));
    secondSlopeVertices.push(new b2Vec2(-.5, 6.14));
    ground.CreateFixtureFromShape(secondSlope, 0);
}
  
function createJ()
{
    //create vertical part of J
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(.54, 5.75));
    leftBarVertices.push(new b2Vec2(.54, 6.38));
    leftBarVertices.push(new b2Vec2(.48, 6.38));
    leftBarVertices.push(new b2Vec2(.48, 5.7));
    ground.CreateFixtureFromShape(leftBarShape, 0);
    
    //create arc for J
    var rightBarShape = new b2PolygonShape();
    var rightBarVertices = rightBarShape.vertices;
    rightBarVertices.push(new b2Vec2(.48, 5.65));
    rightBarVertices.push(new b2Vec2(.48, 5.7));
    rightBarVertices.push(new b2Vec2(.32, 5.72));
    rightBarVertices.push(new b2Vec2(.18, 5.78));
    rightBarVertices.push(new b2Vec2(.2, 5.7));
    ground.CreateFixtureFromShape(rightBarShape, 0);
}
    
function createA()
{
    //create vertical part of a
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(1.17, 5.64));
    leftBarVertices.push(new b2Vec2(1.17, 6.1));
    leftBarVertices.push(new b2Vec2(1.11, 6.1));
    leftBarVertices.push(new b2Vec2(1.11, 5.64));
    ground.CreateFixtureFromShape(leftBarShape, 0);
    
    // top curve of a
    var secondSlope = new b2PolygonShape();
    var secondSlopeVertices = secondSlope.vertices;
    secondSlopeVertices.push(new b2Vec2(.8, 6.09));
    secondSlopeVertices.push(new b2Vec2(.95, 6.15));
    secondSlopeVertices.push(new b2Vec2(1.1, 6.1));
    secondSlopeVertices.push(new b2Vec2(1.1, 6.15));
    secondSlopeVertices.push(new b2Vec2(.95, 6.18));
    secondSlopeVertices.push(new b2Vec2(.85, 6.12));
    ground.CreateFixtureFromShape(secondSlope, 0);
    
    //main curve of a part 1
    var slope = new b2PolygonShape();
    var slopeVertices = slope.vertices;
    slopeVertices.push(new b2Vec2(.8, 5.85));
    slopeVertices.push(new b2Vec2(.95, 5.93));
    slopeVertices.push(new b2Vec2(1.1, 5.9));
    slopeVertices.push(new b2Vec2(1.1, 5.96));
    slopeVertices.push(new b2Vec2(.95, 5.96));
    slopeVertices.push(new b2Vec2(.85, 5.92));
    ground.CreateFixtureFromShape(slope, 0);
    
    //main curve of a part 2
    var slope2 = new b2PolygonShape();
    var slope2Vertices = slope2.vertices;
    slope2Vertices.push(new b2Vec2(.8, 5.67));
    slope2Vertices.push(new b2Vec2(.95, 5.64));
    slope2Vertices.push(new b2Vec2(1.1, 5.71));
    slope2Vertices.push(new b2Vec2(1.1, 5.76));
    slope2Vertices.push(new b2Vec2(.95, 5.67));
    slope2Vertices.push(new b2Vec2(.85, 5.67));
    ground.CreateFixtureFromShape(slope2, 0);
    
    //last lil block for a
    var bloc = new b2PolygonShape();
    var blocVertices = bloc.vertices;
    blocVertices.push(new b2Vec2(.85, 5.87));
    blocVertices.push(new b2Vec2(.85, 5.67));
    blocVertices.push(new b2Vec2(.82, 5.67));
    blocVertices.push(new b2Vec2(.76, 5.77));
    blocVertices.push(new b2Vec2(.79, 5.87));
    ground.CreateFixtureFromShape(bloc, 0);
}

function createR()
{
    // Create the first vertical bar of "m"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(1.42, 5.65));
    leftBarVertices.push(new b2Vec2(1.42, 6.18));
    leftBarVertices.push(new b2Vec2(1.36, 6.18));
    leftBarVertices.push(new b2Vec2(1.36, 5.65));
    ground.CreateFixtureFromShape(leftBarShape, 0);
    
    var secondSlope = new b2PolygonShape();
    var secondSlopeVertices = secondSlope.vertices;
    secondSlopeVertices.push(new b2Vec2(1.4, 5.9));
    secondSlopeVertices.push(new b2Vec2(1.55, 6.15));
    secondSlopeVertices.push(new b2Vec2(1.7, 6.1));
    secondSlopeVertices.push(new b2Vec2(1.7, 6.16));
    secondSlopeVertices.push(new b2Vec2(1.45, 6.1));
    secondSlopeVertices.push(new b2Vec2(1.45, 6.12));
    ground.CreateFixtureFromShape(secondSlope, 0);
}
    
function createE()
{
    // Create the horizontal bar of "H"
    var horizontalBarShape = new b2PolygonShape();
    var horizontalBarVertices = horizontalBarShape.vertices;
    horizontalBarVertices.push(new b2Vec2(2.21, 5.96));
    horizontalBarVertices.push(new b2Vec2(2.21, 5.9));
    horizontalBarVertices.push(new b2Vec2(1.8, 5.9));
    horizontalBarVertices.push(new b2Vec2(1.8, 5.96));
    ground.CreateFixtureFromShape(horizontalBarShape, 0);
    
    // top curve of a
    var secondSlope = new b2PolygonShape();
    var secondSlopeVertices = secondSlope.vertices;
    secondSlopeVertices.push(new b2Vec2(1.9, 6.09));
    secondSlopeVertices.push(new b2Vec2(2.05, 6.15));
    secondSlopeVertices.push(new b2Vec2(2.2, 6.1));
    secondSlopeVertices.push(new b2Vec2(2.2, 6.16));
    secondSlopeVertices.push(new b2Vec2(2.05, 6.18));
    secondSlopeVertices.push(new b2Vec2(1.95, 6.12));
    ground.CreateFixtureFromShape(secondSlope, 0);
    
    //bottom curve of e
    var slope2 = new b2PolygonShape();
    var slope2Vertices = slope2.vertices;
    slope2Vertices.push(new b2Vec2(1.9, 5.74));
    slope2Vertices.push(new b2Vec2(2.05, 5.64));
    slope2Vertices.push(new b2Vec2(2.2, 5.67));
    slope2Vertices.push(new b2Vec2(2.3, 5.75));
    slope2Vertices.push(new b2Vec2(2.2, 5.7));
    slope2Vertices.push(new b2Vec2(2.05, 5.67));
    slope2Vertices.push(new b2Vec2(1.95, 5.67));
    ground.CreateFixtureFromShape(slope2, 0);
    
    // Create the first vertical bar of "m"
    var leftBarShape = new b2PolygonShape();
    var leftBarVertices = leftBarShape.vertices;
    leftBarVertices.push(new b2Vec2(1.88, 5.7));
    leftBarVertices.push(new b2Vec2(1.88, 6.13));
    leftBarVertices.push(new b2Vec2(1.82, 6));
    leftBarVertices.push(new b2Vec2(1.82, 6));
    ground.CreateFixtureFromShape(leftBarShape, 0);
    
    // Create the second vertical bar of "m"
    var midBarShape = new b2PolygonShape();
    var midBarVertices = midBarShape.vertices;
    midBarVertices.push(new b2Vec2(2.21, 5.9));
    midBarVertices.push(new b2Vec2(2.21, 6.15));
    midBarVertices.push(new b2Vec2(2.27, 6));
    midBarVertices.push(new b2Vec2(2.27, 5.9));
    ground.CreateFixtureFromShape(midBarShape, 0);

}
    
    function createD()
    {
        //create vertical part of D
        var leftBarShape = new b2PolygonShape();
        var leftBarVertices = leftBarShape.vertices;
        leftBarVertices.push(new b2Vec2(2.86, 5.65));
        leftBarVertices.push(new b2Vec2(2.86, 6.38));
        leftBarVertices.push(new b2Vec2(2.92, 6.38));
        leftBarVertices.push(new b2Vec2(2.92, 5.65));
        ground.CreateFixtureFromShape(leftBarShape, 0);
    
	// top curve of d
	var secondSlope = new b2PolygonShape();
	var secondSlopeVertices = secondSlope.vertices;
	secondSlopeVertices.push(new b2Vec2(2.5, 6.09));
	secondSlopeVertices.push(new b2Vec2(2.65, 6.15));
	secondSlopeVertices.push(new b2Vec2(2.9, 6.05));
	secondSlopeVertices.push(new b2Vec2(2.9, 6.11));
	secondSlopeVertices.push(new b2Vec2(2.65, 6.18));
	secondSlopeVertices.push(new b2Vec2(2.55, 6.12));
	ground.CreateFixtureFromShape(secondSlope, 0);

	//bottom curve of e
	var slope2 = new b2PolygonShape();
	var slope2Vertices = slope2.vertices;
	slope2Vertices.push(new b2Vec2(2.5, 5.74));
	slope2Vertices.push(new b2Vec2(2.65, 5.64));
	slope2Vertices.push(new b2Vec2(2.8, 5.67));
	slope2Vertices.push(new b2Vec2(2.9, 5.75));
	slope2Vertices.push(new b2Vec2(2.8, 5.7));
	slope2Vertices.push(new b2Vec2(2.65, 5.67));
	slope2Vertices.push(new b2Vec2(2.55, 5.67));
	ground.CreateFixtureFromShape(slope2, 0);



	// Create the first vertical bar of "m"
	var rightBarShape = new b2PolygonShape();
	var rightBarShapeVertices = rightBarShape.vertices;
	rightBarShapeVertices.push(new b2Vec2(2.5, 5.7));
	rightBarShapeVertices.push(new b2Vec2(2.5, 6.13));
	rightBarShapeVertices.push(new b2Vec2(2.44, 6));
	rightBarShapeVertices.push(new b2Vec2(2.44, 6));
	ground.CreateFixtureFromShape(rightBarShape, 0);
    }
    
function createPeriod()
{
	//create vertical part of D
	var leftBarShape = new b2PolygonShape();
	var leftBarVertices = leftBarShape.vertices;
	leftBarVertices.push(new b2Vec2(3.2, 5.65));
	leftBarVertices.push(new b2Vec2(3.2, 5.76));
	leftBarVertices.push(new b2Vec2(3.14, 5.76));
	leftBarVertices.push(new b2Vec2(3.14, 5.65));
	ground.CreateFixtureFromShape(leftBarShape, 0);
}

function createLine()
{
	// Create the first vertical bar of "m"
	var leftBarShape = new b2PolygonShape();
	var leftBarVertices = leftBarShape.vertices;
	leftBarVertices.push(new b2Vec2(-4.1, 5.33));
	leftBarVertices.push(new b2Vec2(-4.1, 5.39));
	leftBarVertices.push(new b2Vec2(4.1, 5.39));
	leftBarVertices.push(new b2Vec2(4.1, 5.33));
	ground.CreateFixtureFromShape(leftBarShape, 0);
}
}

// Function to create an elastic box within the newly created particle system
function createElasticBox() {
	var color = rgbaColors[getRandomInt(6)];
	var box = new b2PolygonShape();
	var pgd = new b2ParticleGroupDef();
	box.SetAsBoxXY(0.5, .5);
	pgd.flags = b2_elasticParticle;
	pgd.groupFlags = b2_solidParticleGroup;
	pgd.position.Set(1, 4);
	pgd.angle = -0.5;
	pgd.angularVelocity = 2;
	pgd.shape = box;
	pgd.color.Set(color[0], color[1], color[2], 200);
	var particleGroup = particleSystem.CreateParticleGroup(pgd);
	jellies.push(particleGroup);
}
	
function createSmallElasticBox() {
	var color = rgbaColors[getRandomInt(6)];
	var box = new b2PolygonShape();
	var pgd = new b2ParticleGroupDef();
	box.SetAsBoxXY(0.2, .2);
	pgd.flags = b2_elasticParticle;
	pgd.groupFlags = b2_solidParticleGroup;
	pgd.position.Set(-7, 6);
	pgd.angle = -0.5;
	pgd.angularVelocity = 2;
	pgd.shape = box;
	pgd.color.Set(color[0], color[1], color[2], 200);
	var particleGroup = particleSystem.CreateParticleGroup(pgd);
	jellies.push(particleGroup);
}
	
function createElasticRod() {
	var color = rgbaColors[getRandomInt(6)];
	var box = new b2PolygonShape();
	var pgd = new b2ParticleGroupDef();
	box.SetAsBoxXY(0.1, 2);
	pgd.flags = b2_elasticParticle;
	pgd.groupFlags = b2_solidParticleGroup;
	pgd.position.Set(-7, 7);
	pgd.angle = -0.5;
	pgd.angularVelocity = 2;
	pgd.shape = box;
	pgd.color.Set(color[0], color[1], color[2], 200);
	var particleGroup = particleSystem.CreateParticleGroup(pgd);
	jellies.push(particleGroup);
}

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

let result;

function toggleClearButton() {
    var clearButton = document.getElementById("clearButton");

    // Check if the clear button is currently hidden
    if (clearButton.style.display === "none" || clearButton.style.display === "") {
        clearButton.style.display = "block"; // Make it visible
        console.log('Clear button is now visible');
    }
}


function buttonClicked() {
	toggleClearButton();
	result = getRandomInt(3);
	switch (result){
		case 0:
			createElasticBox();
			break;
		case 1:
			createSmallElasticBox();
			break;
		case 2:
			createElasticRod();
			break;
	}
}

function clearButtonClicked() {
	var clearButton = document.getElementById("clearButton");
	
	// Hide the clear button when it's clicked
	clearButton.style.display = "none";
	
	// Ensure jellies is defined and contains particles
	if (Array.isArray(jellies) && jellies.length > 0) {
		// Loop backwards to safely remove particles
		for (var i = jellies.length - 1; i >= 0; i--) {
		    if (jellies[i]) {
			jellies[i].DestroyParticles(true); // Ensure this method is correct
		    }
		}
	} else {
		console.log('No jellies to destroy');
	}
}
