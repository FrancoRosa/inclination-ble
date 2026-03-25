import { createBluetooth } from "node-ble";
import { MACS } from "./settings.mjs";

const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
const CHAR_NOTIFY_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";
const CHAR_WRITE_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

let connected = false;

class DeviceModel {
  constructor(deviceName, callback) {
    this.deviceName = deviceName;
    this.callback = callback;
    this.buffer = [];
    this.peripheral = null;
    this.writeChar = null;
    this.pollInterval = null;
  }

  getSignInt16(x) {
    return x >= 0x8000 ? x - 0x10000 : x;
  }

  processData(frame) {
    if (frame[1] === 0x61) {
      const angX =
        (this.getSignInt16((frame[15] << 8) | frame[14]) / 32768) * 180;
      const angY =
        (this.getSignInt16((frame[17] << 8) | frame[16]) / 32768) * 180;
      const angZ =
        (this.getSignInt16((frame[19] << 8) | frame[18]) / 32768) * 180;
      const deviceData = {
        AngX: Number(angX.toFixed(3)),
        AngY: Number(angY.toFixed(3)),
        AngZ: Number(angZ.toFixed(3)),
      };
      this.callback(deviceData);
    } else {
      // length 20 from magnetic or quaternion; keep it for future data if needed
      if (frame[2] === 0x3a) {
        // magnetic field packet
        // no callback in your Python variant
      } else if (frame[2] === 0x51) {
        // quaternion packet
      }
    }
  }

  onDataReceived(data) {
    const bytes = [...data];

    for (const b of bytes) {
      this.buffer.push(b);

      if (this.buffer.length === 1 && this.buffer[0] !== 0x55) {
        this.buffer.shift();
        continue;
      }
      if (
        this.buffer.length === 2 &&
        this.buffer[1] !== 0x61 &&
        this.buffer[1] !== 0x71
      ) {
        this.buffer.shift();
        continue;
      }
      if (this.buffer.length === 20) {
        this.processData([...this.buffer]);
        this.buffer.length = 0;
      }
    }
  }

  getReadBytes(regAddr) {
    return Buffer.from([0xff, 0xaa, 0x27, regAddr, 0x00]);
  }

  getWriteBytes(regAddr, value) {
    return Buffer.from([
      0xff,
      0xaa,
      regAddr,
      value & 0xff,
      (value >> 8) & 0xff,
    ]);
  }

  async sendData(buf) {
    if (!this.writeChar) return;
    await this.writeChar.writeValue(buf);
  }

  async readReg(regAddr) {
    await this.sendData(this.getReadBytes(regAddr));
  }

  async writeReg(regAddr, val) {
    await this.unlock();
    await new Promise((r) => setTimeout(r, 100));
    await this.sendData(this.getWriteBytes(regAddr, val));
    await new Promise((r) => setTimeout(r, 100));
    await this.save();
  }

  async unlock() {
    await this.sendData(this.getWriteBytes(0x69, 0xb588));
  }

  async save() {
    await this.sendData(this.getWriteBytes(0x00, 0x0000));
  }

  async startPolling() {
    this.pollInterval = setInterval(async () => {
      if (!connected) {
        try {
          await this.readReg(0x3a);
          await new Promise((r) => setTimeout(r, 100));
          await this.readReg(0x51);
        } catch (err) {
          console.error("Polling error:", err);
        }
      }
    }, 500);
  }

  stopPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  async openDevice(MAC) {
    const { bluetooth } = createBluetooth();
    const adapter = await bluetooth.defaultAdapter();
    const device = await adapter.waitDevice(MAC);
    await device.connect();
    const gattServer = await device.gatt();
    const targetService = await gattServer.getPrimaryService(SERVICE_UUID);

    if (!targetService) throw new Error("Service not found");

    this.writeChar = await targetService.getCharacteristic(CHAR_WRITE_UUID);
    const notifyChar = await targetService.getCharacteristic(CHAR_NOTIFY_UUID);

    if (!this.writeChar || !notifyChar)
      throw new Error("Required chars not found");
    connected = true;
    // await notifyChar.startNotifications((value) => this.onDataReceived(value));
    // console.log("Notifications started");

    notifyChar.on("valuechanged", (buffer) => {
      this.onDataReceived(buffer);
    });
    await notifyChar.startNotifications();

    await this.startPolling();
  }

  async closeDevice() {
    this.stopPolling();
    if (this.peripheral) {
      await this.peripheral.disconnect();
      this.peripheral = null;
    }
    connected = false;
    console.log("Device closed");
  }
}

const sensors = { dev1: {}, dev2: {}, dev3: {} };

function updateData(data, name) {
  sensors[name] = data;
}

setInterval(() => {
  console.log(new Date().toLocaleString("sv").slice(10), sensors);
}, 200);

async function main() {
  const dev1 = new DeviceModel("dev1", (d) => updateData(d, "dev1"));
  const dev2 = new DeviceModel("dev2", (d) => updateData(d, "dev2"));
  const dev3 = new DeviceModel("dev3", (d) => updateData(d, "dev3"));
  try {
    dev1.openDevice(MACS[0]).then((res) => console.log("Dev1 connected!"));
    dev2.openDevice(MACS[1]).then((res) => console.log("Dev2 connected!"));
    dev3.openDevice(MACS[2]).then((res) => console.log("Dev3 connected!"));
  } catch (err) {
    console.error("Error", err);
  }

  process.on("SIGINT", async () => {
    await dev1.closeDevice();
    await dev2.closeDevice();
    await dev3.closeDevice();
    process.exit(0);
  });
}

main();
