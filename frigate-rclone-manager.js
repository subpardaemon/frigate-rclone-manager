require('dotenv').config();
const mqtt = require("mqtt");
const { spawn } = require("node:child_process");

let mqttClient;
let detections = [];
const rcloneCommands = [];
let rcloneTimer = null;
let rcloneBusy = false;

const config = {
    mqtt: {
        host: process.env['MQTT_HOST'] || "test.mosquitto.org",
        port: parseInt(process.env['MQTT_PORT']) || 1884,
        user: process.env['MQTT_USER'] || "ro",
        pass: process.env['MQTT_PASS'] || "readonly",
        topics: ["frigate/events"],
    },
    // seconds
    waitAfterTriggered: parseInt(process.env['FRAC_WAIT_AFTER_TRIGGERED']) || 1,
    runInterval: parseInt(process.env['FRAC_RUN_INTERVAL']) || 15,
    launchAfterUntriggered: parseInt(process.env['FRAC_LAUNCH_AFTER_UNTRIGGERED']) || 20,
    eventTimeout: parseInt(process.env['FRAC_EVENT_TIMEOUT']) || 600,
    // will be run simultaneously
    rcloneCommands: process.env['FRAC_RCLONE_ACTIONS'].split(';;')
};

const shouldSync = () => {
    return detections.length > 0;
};

const scheduleNextRun = (waitSecs, isLast = false) => {
    if (rcloneTimer) {
        clearTimeout(rcloneTimer);
    }
    rcloneTimer = setTimeout(launchRclone, waitSecs * 1000, [isLast]);
    console.log(`Scheduled next run in ${waitSecs} seconds`);
};

const launchRcloneCommand = (command) => {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, { shell: true, stdio: "ignore" });
        proc.on("close", (code) => {
            if (code !== 0) {
                console.log(`rclone command exited with code ${code}`);
                reject();
            } else {
                resolve();
            }
        });
    });
};

const launchRclone = async (isLast = false) => {
    if (rcloneBusy) {
        scheduleNextRun(1);
    }
    try {
        rcloneBusy = true;
        rcloneTimer = null;

        const awaits = [];
        for (const command of rcloneCommands) {
            awaits.push(launchRcloneCommand(command));
        }

        await Promise.all(awaits);
    } catch (e) {
        console.error(e);
    } finally {
        cleanupDetections();
        rcloneBusy = false;

        if (shouldSync()) {
            scheduleNextRun(config.runInterval);
        } else if (isLast === false) {
            scheduleNextRun(config.launchAfterUntriggered, true);
        }
    }
};

const cleanupDetections = () => {
    const now = Date.now();
    detections = detections.filter((d) => {
        return now - d.started < config.eventTimeout * 1000;
    });
};

const addDetection = (id) => {
    console.log('Detection with ID', id);
    let alreadyKnown = null;
    for (const detection of detections) {
        if (detection.id === id) {
            alreadyKnown = detection;
            break;
        }
    }

    if (alreadyKnown === null) {
        detections.push({ id, started: Date.now() });
    } else {
        alreadyKnown.started = Date.now();
    }

    if (shouldSync()) {
        scheduleNextRun(config.waitAfterTriggered);
    }
}

const removeDetection = (id) => {
    detections = detections.filter((d) => d.id !== id);
}

const onMessage = (topic, message) => {
    try {
        console.log(`Received message on ${topic}`);
        const data = JSON.parse(message.toString());
        if (topic === "frigate/events" && data.type && data.after) {
            if (data.type === "end") {
                removeDetection(data.after.id);
            } else {
                addDetection(data.after.id);
            }
    
        }
    } catch (e) {
        console.error(e);
    }
};

const onConnect = () => {
    console.log("Connected to MQTT");
    for (const topic of config.mqtt.topics) {
        mqttClient.subscribe(topic);
    }
};

const onDisconnect = () => {
    console.log("Disconnected from MQTT");
};

const main = () => {
    mqttClient = mqtt.connect({
        host: config.mqtt.host,
        port: config.mqtt.port,
        username: config.mqtt.user,
        password: config.mqtt.pass,
    });

    mqttClient.on("connect", onConnect);
    mqttClient.on("disconnect", onDisconnect);
    mqttClient.on("message", onMessage);
};

main();

/**
 * TEST:
 * mosquitto_pub -h test.mosquitto.org -p 1884 -u rw -P readwrite -t frigate/events -d -l
 * 
 * {"type":"new","before":{},"after":{"id":"AAAA-1000"}}
 * {"type":"new","before":{},"after":{"id":"AAAA-1001"}}
 * {"type":"update","before":{},"after":{"id":"AAAA-1000"}}
 * {"type":"update","before":{},"after":{"id":"AAAA-1001"}}
 * {"type":"end","before":{},"after":{"id":"AAAA-1000"}}
 * {"type":"end","before":{},"after":{"id":"AAAA-1001"}}
 */