const mqtt = require("mqtt");
const { spawn } = require("node:child_process");

let mqttClient;
let detections = [];
const rcloneCommands = [];
let rcloneTimer = null;
let rcloneBusy = false;

const config = {
    mqtt: {
        host: "test.mosquitto.org",
        port: 1883,
        user: "",
        pass: "",
        topics: ["frigate/events"],
    },
    friagate: {
        events: true
    },
    // seconds
    waitAfterTriggered: 1,
    runInterval: 15,
    launchAfterUntriggered: 15,
    eventTimeout: 600,
    // will be run simultaneously
    rcloneCommands: [
        'rclone sync /home/pdx/frigate/media/clips OphionFTP:/media/dmu/subpardaemon/frigate/clips --check-first --ignore-checksum',
        'rclone sync /home/pdx/frigate/media/recordings OphionFTP:/media/dmu/subpardaemon/frigate/recordings --check-first --ignore-checksum'
    ],
};

const shouldSync = () => {
    return detections.length > 0;
};

const scheduleNextRun = (waitSecs, isLast = false) => {
    if (rcloneTimer) {
        clearTimeout(rcloneTimer);
    }
    rcloneTimer = setTimeout(launchRclone, waitSecs * 1000, [isLast]);
}

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
        const data = JSON.parse(message.toString());
        if (topic === "frigate/events" && config.frigate.events && data.type) {
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