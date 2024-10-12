var isMac = navigator.platform.toUpperCase().indexOf('MAC')>=0;

// shouldnt be a global :(
var particleColors = [
  new b2ParticleColor(0xff, 0x00, 0x00, 0xff), // red
  new b2ParticleColor(0x00, 0xff, 0x00, 0xff), // green
  new b2ParticleColor(0x00, 0x00, 0xff, 0xff), // blue
  new b2ParticleColor(0xff, 0x8c, 0x00, 0xff), // orange
  new b2ParticleColor(0x00, 0xce, 0xd1, 0xff), // turquoise
  new b2ParticleColor(0xff, 0x00, 0xff, 0xff), // magenta
  new b2ParticleColor(0xff, 0xd7, 0x00, 0xff), // gold
  new b2ParticleColor(0x00, 0xff, 0xff, 0xff) // cyan
];
var container;
var world = null;
var threeRenderer;
var renderer;
var camera;
var scene;
var objects = [];
var timeStep = 1.0 / 60.0;
var velocityIterations = 8;
var positionIterations = 3;
var test = {};
var projector = new THREE.Projector();
var planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
var g_groundBody = null;
var windowWidth = window.innerWidth;
var windowHeight = window.innerHeight;

//var GenerateOffsets = Module.cwrap("GenerateOffsets", 'null');

// Create a slider element and set its attributes
function createSlider() {
    // Create the input element of type range
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'gravitySlider'; // Set ID to access it later
    slider.min = -9.8;
    slider.max = 9.8;
    slider.step = 0.1;
    slider.value = -9.8;

    // Style the slider to position it without interfering with other elements
    slider.style.position = 'absolute';
    slider.style.top = '20px'; // Adjust as needed
    slider.style.left = '20px'; // Adjust as needed
    slider.style.zIndex = 1000; // Ensure it's on top of other elements

    // Create a label to display the gravity value
    var label = document.createElement('span');
    label.id = 'gravityValue'; // Set ID for easy reference
    label.style.position = 'absolute';
    label.style.top = '20px'; // Align with the slider
    label.style.left = '180px'; // Adjust position to be next to the slider
    label.style.zIndex = 1000;
    label.style.fontSize = '16px'; // Set font size for readability
    label.style.color = '#333'; // Set a color that contrasts with the background

    // Append the slider and label to the body
    document.body.appendChild(slider);
    document.body.appendChild(label);

    // Initialize label value
    label.innerHTML = `Gravity: ${parseFloat(slider.value).toFixed(1)} m/s&sup2;`;

    // Add an event listener to update gravity and label when the slider value changes
    slider.addEventListener('input', function () {
        let gravityValue = parseFloat(slider.value);

        // Snap to zero if within the snapping range
        if (gravityValue > -0.5 && gravityValue < 0.5) {
            gravityValue = 0;
            slider.value = 0; // Update slider position to snap visually
        }

        // Format the value to one decimal place
        const formattedGravityValue = gravityValue.toFixed(1);
				
	updateGravity(gravityValue);
			
        label.innerHTML = `Gravity: ${formattedGravityValue} m/s&sup2;`;
    });
}

// Function to update gravity
function updateGravity(grav) {
    if (world) {
			
			if (isMac) {
				world.SetGravity(new b2Vec2(0, grav));
			} else {
				world.SetGravity(new b2Vec2(0, grav/2));
			}
        console.log(`Gravity updated to: ${grav}`);
    } else {
        console.error('World is not initialized');
    }
}

// Initialize the testbed and create the slider
function initTestbed() {
    camera = new THREE.PerspectiveCamera(70, (windowWidth * (windowWidth/1386)) / (windowHeight * (windowHeight/818)), 1, 1000);
    threeRenderer = new THREE.WebGLRenderer();
    threeRenderer.setClearColor(0xf2f2f2);
    threeRenderer.setSize(windowWidth, windowHeight);
    camera.position.x = 0;
    camera.position.y = 0;
    camera.position.z = 100;
    scene = new THREE.Scene();
    camera.lookAt(scene.position);

    document.body.appendChild(threeRenderer.domElement);

    this.mouseJoint = null;
		
		world = new b2World(-9.8);
	
    // Create Box2D world with default gravity
		if (isMac) {
			world.SetGravity(new b2Vec2(0, -9.8));
		} else {
			world.SetGravity(new b2Vec2(0, -4.8));
		}

    renderer = new Renderer();
    Testbed();

    // Call the function to create the slider and display
    createSlider();
}

//real gravity values here
function testSwitch(testName) {
  ResetWorld();
	if (isMac) {
		world.SetGravity(new b2Vec2(0, -9.8));
	} else if (!isMac) {
		world.SetGravity(new b2Vec2(0, -4.8));
	}
  var bd = new b2BodyDef;
  g_groundBody = world.CreateBody(bd);
  test = new window[testName];
}

function Testbed(obj) {
  // Init world
  //GenerateOffsets();
  //Init
  var that = this;
  document.addEventListener('keypress', function(event) {
    if (test.Keyboard !== undefined) {
      test.Keyboard(String.fromCharCode(event.which) );
    }
  });
  document.addEventListener('keyup', function(event) {
    if (test.KeyboardUp !== undefined) {
      test.KeyboardUp(String.fromCharCode(event.which) );
    }
  });

    //responsible for dragging objects
  document.addEventListener('mousedown', function(event) {
    var p = getMouseCoords(event);
    var aabb = new b2AABB;
    var d = new b2Vec2;

    d.Set(0.01, 0.01);
    b2Vec2.Sub(aabb.lowerBound, p, d);
    b2Vec2.Add(aabb.upperBound, p, d);

    var queryCallback = new QueryCallback(p);
    world.QueryAABB(queryCallback, aabb);

    if (queryCallback.fixture) {
      var body = queryCallback.fixture.body;
      var md = new b2MouseJointDef;
      md.bodyA = g_groundBody;
      md.bodyB = body;
      md.target = p;
      md.maxForce = 1000 * body.GetMass();
      that.mouseJoint = world.CreateJoint(md);
      body.SetAwake(true);
    }
    if (test.MouseDown !== undefined) {
      test.MouseDown(p);
    }
  });

    //objects follow mouse on drag
  document.addEventListener('mousemove', function(event) {
    var p = getMouseCoords(event);
    if (that.mouseJoint) {
      that.mouseJoint.SetTarget(p);
    }
    if (test.MouseMove !== undefined) {
      test.MouseMove(p);
    }
  });

    //objects stop following on mouse release <-- potentially handle link opening here, track shapes via array
  document.addEventListener('mouseup', function(event) {
    if (that.mouseJoint) {
      world.DestroyJoint(that.mouseJoint);
      that.mouseJoint = null;
		}
    if (test.MouseUp !== undefined) {
      test.MouseUp(getMouseCoords(event));
    }
  });

	    //responsible for dragging objects
  document.addEventListener('touchstart', function(event) {
    var p = getTouchCoords(event);
    var aabb = new b2AABB;
    var d = new b2Vec2;

    d.Set(0.01, 0.01);
    b2Vec2.Sub(aabb.lowerBound, p, d);
    b2Vec2.Add(aabb.upperBound, p, d);

    var queryCallback = new QueryCallback(p);
    world.QueryAABB(queryCallback, aabb);

    if (queryCallback.fixture) {
      var body = queryCallback.fixture.body;
      var md = new b2MouseJointDef;
      md.bodyA = g_groundBody;
      md.bodyB = body;
      md.target = p;
      md.maxForce = 1000 * body.GetMass();
      that.mouseJoint = world.CreateJoint(md);
      body.SetAwake(true);
    }
    if (test.MouseDown !== undefined) {
      test.MouseDown(p);
    }
  });

    //objects follow mouse on drag
  document.addEventListener('touchmove', function(event) {
    var p = getTouchCoords(event);
    if (that.mouseJoint) {
      that.mouseJoint.SetTarget(p);
    }
    if (test.MouseMove !== undefined) {
      test.MouseMove(p);
    }
  });

    //objects stop following on mouse release <-- potentially handle link opening here, track shapes via array
  document.addEventListener('touchend', function(event) {
    if (that.mouseJoint) {
      world.DestroyJoint(that.mouseJoint);
      that.mouseJoint = null;
		}
    if (test.MouseUp !== undefined) {
      test.MouseUp(getTouchCoords(event));
    }
  });

  window.addEventListener( 'resize', onWindowResize, false );

  testSwitch("TestParticles");

  render();
}

var render = function() {
  // bring objects into world
  renderer.currentVertex = 0;
  if (test.Step !== undefined) {
    test.Step();
  } else {
    Step();
  }
  renderer.draw();
  threeRenderer.render(scene, camera);
  requestAnimationFrame(render);
};

var ResetWorld = function() {
  if (world !== null) {
    while (world.joints.length > 0) {
      world.DestroyJoint(world.joints[0]);
    }

    while (world.bodies.length > 0) {
      world.DestroyBody(world.bodies[0]);
    }

    while (world.particleSystems.length > 0) {
      world.DestroyParticleSystem(world.particleSystems[0]);
    }
  }
  camera.position.x = 0;
  camera.position.y = 0;
  camera.position.z = 100;
};

var Step = function() {
  world.Step(timeStep, velocityIterations, positionIterations);
};

/**@constructor*/
function QueryCallback(point) {
  this.point = point;
  this.fixture = null;
}

/**@return bool*/
QueryCallback.prototype.ReportFixture = function(fixture) {
  var body = fixture.body;
  if (body.GetType() === b2_dynamicBody) {
    var inside = fixture.TestPoint(this.point);
    if (inside) {
      this.fixture = fixture;
      return true;
    }
  }
  return false;
};

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  threeRenderer.setSize( window.innerWidth, window.innerHeight );
}

function getMouseCoords(event) {
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

function getTouchCoords(event)
{
	var finger = new THREE.Vector3();
	var touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
	finger.x = (touch.pageX / window.innerWidth) * 2 - 1;
	finger.y = -(touch.pageY / window.innerWidth) * 2 + 1;
	finger.z = 0.5;

  projector.unprojectVector(finger, camera);
  var dir = finger.sub(camera.position).normalize();
  var distance = -camera.position.z / dir.z;
  var pos = camera.position.clone().add(dir.multiplyScalar(distance));
  var p = new b2Vec2(pos.x, pos.y);
  return p;
}

