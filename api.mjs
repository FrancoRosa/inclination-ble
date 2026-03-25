import DeviceModel from "./device-handler.mjs";
import { MACS } from "./settings.mjs";
import { createServer } from "http";
import { Server } from "socket.io";

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

server.listen(10002);

const sensors = { dev1: {}, dev2: {}, dev3: {} };

function updateData(data, name) {
  sensors[name] = data;
}

setInterval(() => {
  console.log(new Date().toLocaleString("sv").slice(10), sensors);
  io.emit("sensors", sensors);
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
