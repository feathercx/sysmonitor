const protobuf = require("protobufjs")

const pSysMonitor = protobuf.loadSync("sysmonitor.proto")

const Command = pSysMonitor.lookupType("Command")
const Reply = pSysMonitor.lookupType("Reply")

const ffi = require("ffi-napi")
const ref = require("ref-napi")
const StructType = require("ref-struct-di")(ref)

const mq_attr = StructType({
    mq_flags: "int",
    mq_maxmsg: "int",
    mq_msgsize: "int",
    mq_curmsgs: "int"
})

const librt = ffi.Library("librt.so.1", {
    "mq_open": ["int", ["string", "int", "int", "pointer"]],

    "mq_setattr": ["int", ["int", mq_attr, "pointer"]],

    "mq_receive": ["size_t", ["int", "pointer", "size_t", "pointer"]],

    "mq_send": ["int", ["int", "pointer", "int", "int"]],

    "mq_close": ["int", ["int"]]
})

function mqOpen(path, flags) {
    const s1 = librt.mq_open(path, flags | 0o00000100 | 0o00004000, 0o777, null)
    if (s1 < 0) {
        console.log("cant open " + path + " errno = " + ffi.errno())
        return -1;
    }

    const attr = new mq_attr({
        mq_flags: 0o00004000,
        mq_maxmsg: 1,
        mq_msgsize: 10,
        mq_curmsgs: 0
    })

    if (librt.mq_setattr(s1, attr.ref(), null) < 0) {
        console.log("mq_setattr errno=" + ffi.errno())
        librt.mq_close(s1)
        return -1;
    }
    
    return s1;
}

const buf = Buffer.alloc(8192)
const prio = Buffer.alloc(4)

function mqReceive(s) {
    const ret = librt.mq_receive(s, buf, buf.length.toString(), prio).toString()
    if (ret == "18446744073709551615") {
        const err = ffi.errno()
        if (err != 11) {
            console.log(err)
        }
        return [-1, null, null]
    }
    const prioI = prio.readUInt32LE()
    return [parseInt(ret), buf, prioI]
}

function mqSend(s, data, prio = 0) {
    return librt.mq_send(s, data, data.length, prio)
}

const sCommand = mqOpen("/sysmonitoremu.command2", 0o00000000)
const sReply = mqOpen("/sysmonitoremu.reply2", 0o00000001)

console.log(sCommand, sReply)

setInterval(() => {
    const [ret, data, prio] = mqReceive(sCommand)
    if (ret < 0)
        return;
    const command = Command.decode(data.subarray(0, ret))
    console.log(command)

    // all of this is just guessing
    // but it should work

    const reply = {
        sequence: command.sequence ?? undefined
    }

    if (command.checkCable) {
        reply.checkCable = {
            state: 3,
            name: command.checkCable,
            address: "192.168.92.11"
        }
    }

    if (command.traceRoute) {
        reply.traceRoute = {
            state: 3,
            value: command.traceRoute
        }
    }

    if (command.renewDhcp) {
        reply.renewDhcp = {
            state: 3,
            name: command.renewDhcp,
            address: "192.168.92.11"
        }
    }

    reply.ping = []
    if (command.ping && command.ping.length > 0) {
        for (let i = 0; i < command.ping.length; i++) {
            reply.ping.push({
                state: 3,
                value: 0
            })
        }
    }

    if (command.ntp) {
        reply.ntp = {
            state: 3
        }
    }

    for (let key in reply)
        if (reply[key].state)
            reply[key].state = 1;
    mqSend(sReply, Reply.encode(reply).finish(), prio)
    for (let key in reply)
        if (reply[key].state)
            reply[key].state = 3;
    mqSend(sReply, Reply.encode(reply).finish(), prio)
}, 16)
