"use strict";
  const video1 = document.querySelector("video#video1");
  const video2 = document.querySelector("video#video2");
  const videoMonitor = document.querySelector("#video-monitor");

  const startButton = document.querySelector("button#start");
  const callButton = document.querySelector("button#call");
  const hangupButton = document.querySelector("button#hangup");

  const banner = document.querySelector("#banner");
  const muteMiddleBox = document.querySelector("#mute-middlebox");

  startButton.onclick = start;
  callButton.onclick = call;
  hangupButton.onclick = hangup;

  muteMiddleBox.addEventListener("change", toggleMute);

  let startToMiddle;
  let startToEnd;

  const frameTypeToCryptoOffset = {
    key: 10,
    delta: 3,
    undefined: 1,
  };

  let key = 'ec75109d-bfe2-48';
  let iv = "KCap6JeLif31Q9xs";
  let localStream;
  let remoteStream;

  let useCryptoOffset = true;

  function gotStream(stream) {
    console.log("Received local stream");
    video1.srcObject = stream;
    localStream = stream;
    callButton.disabled = false;
  }

  function gotRemoteStream(stream) {
    console.log("Received remote stream");
    remoteStream = stream;
    video2.srcObject = stream;
  }

  function start() {
    console.log("Requesting local stream");
    startButton.disabled = true;
    const options = { audio: true, video: true };
    navigator.mediaDevices
      .getUserMedia(options)
      .then(gotStream)
      .catch(function (e) {
        alert("getUserMedia() failed");
        console.log("getUserMedia() error: ", e);
      });
  }

  function base64ToArrayBuffer(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function encodeFunction(encodedFrame, controller) {
      const view = new DataView(encodedFrame.data);

      // Trước khi mã hoá thì cắt ra cái offset thông báo media type đã, đoạn này không được mã hoá, không lỗi mất :3
      const cryptoOffset = useCryptoOffset
        ? frameTypeToCryptoOffset[encodedFrame.type]
        : 0;

      const bufferAfterCutOffset = encodedFrame.data.slice(cryptoOffset);
      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(bufferAfterCutOffset))
      );

      // Mã hoá AES CBC
      const encryptedData = CryptoJS.AES.encrypt(base64String, key, {
        iv: CryptoJS.enc.Utf8.parse(iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      // const encryptedData = CryptoJS.AES.encrypt(
      //   base64String,
      //   currentCryptoKey
      // );


      const encryptedArrayBuffer = base64ToArrayBuffer(encryptedData);

      const encryptView = new DataView(encryptedArrayBuffer);

      const newData = new ArrayBuffer(
        encryptedArrayBuffer.byteLength + cryptoOffset
      );

      const newView = new DataView(newData);

      // Thêm cryptoOffset
      for (let i = 0; i < cryptoOffset; ++i) {
        newView.setInt8(i, view.getInt8(i));
      }

      // Thêm encrypt data
      for (let i = 0; i < encryptedArrayBuffer.byteLength; ++i) {
        newView.setInt8(i + cryptoOffset, encryptView.getInt8(i));
      encodedFrame.data = newData;
    }
    controller.enqueue(encodedFrame);
  }

  async function decodeFunction(encodedFrame, controller) {
      const view = new DataView(encodedFrame.data);
      const cryptoOffset = useCryptoOffset
        ? frameTypeToCryptoOffset[encodedFrame.type]
        : 0;

      // 1. Giải mã phần data bị mã hoá

      const bufferAfterCutOffset = encodedFrame.data.slice(cryptoOffset);

      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(bufferAfterCutOffset))
      );

      // const decryptedData = CryptoJS.AES.decrypt(
      //   base64String,
      //   currentCryptoKey
      // ).toString(CryptoJS.enc.Utf8);

      const decryptedData = CryptoJS.AES.decrypt(base64String, key, {
        iv: CryptoJS.enc.Utf8.parse(iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }).toString(CryptoJS.enc.Utf8);

      const decryptedArrayBuffer = base64ToArrayBuffer(decryptedData);

      const decryptView = new DataView(decryptedArrayBuffer);

      const newData = new ArrayBuffer(
        decryptedArrayBuffer.byteLength + cryptoOffset
      );
      const newView = new DataView(newData);

      // Thêm offset vào
      for (let i = 0; i < cryptoOffset; ++i) {
        newView.setInt8(i, view.getInt8(i));
      }

      // Thêm phần data đã giải mã vào
      for (let i = 0; i < decryptedArrayBuffer.byteLength; ++i) {
        newView.setInt8(i + cryptoOffset, decryptView.getInt8(i));
      }

      encodedFrame.data = newData;
    controller.enqueue(encodedFrame);
  }

  function setupSenderTransform(sender) {
    const senderStreams = sender.createEncodedStreams();
    const transformStream = new TransformStream({
      transform: encodeFunction,
    });
    senderStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(senderStreams.writable);
  }

  function setupReceiverTransform(receiver) {
    const receiverStreams = receiver.createEncodedStreams();
    const transformStream = new TransformStream({
      transform: decodeFunction,
    });
    receiverStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(receiverStreams.writable);
  }

  function call() {
    callButton.disabled = true;
    hangupButton.disabled = false;
    console.log("Starting call");
    startToMiddle = new VideoPipe(localStream, true, false, (e) => {
      // Do not setup the receiver transform.
      videoMonitor.srcObject = e.streams[0];
    });
    startToMiddle.pc1.getSenders().forEach(setupSenderTransform);
    startToMiddle.negotiate();

    startToEnd = new VideoPipe(localStream, true, true, (e) => {
      setupReceiverTransform(e.receiver);
      gotRemoteStream(e.streams[0]);
    });
    startToEnd.pc1.getSenders().forEach(setupSenderTransform);
    startToEnd.negotiate();

    console.log("Video pipes created");
  }

  function hangup() {
    console.log("Ending call");
    startToMiddle.close();
    startToEnd.close();
    hangupButton.disabled = true;
    callButton.disabled = false;
  }

  function toggleMute(event) {
    video2.muted = muteMiddleBox.checked;
    videoMonitor.muted = !muteMiddleBox.checked;
  }
