package main

import (
	"fmt"
	"strings"

	"go.bug.st/serial"
)

// listSerialPorts returns the list of available serial port names.
func (a *App) listSerialPorts() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, err
	}
	return ports, nil
}

// connectSerial connects to a local serial port and pipes it to the WebSocket path.
func (a *App) connectSerial(sessionId string, name string, portName string, baudRate int, dataBits int, stopBits float64, parity string) error {
	var sb serial.StopBits
	switch stopBits {
	case 1.5:
		sb = serial.OnePointFiveStopBits
	case 2:
		sb = serial.TwoStopBits
	default:
		sb = serial.OneStopBit
	}

	parityMap := map[string]serial.Parity{
		"none":  serial.NoParity,
		"odd":   serial.OddParity,
		"even":  serial.EvenParity,
		"mark":  serial.MarkParity,
		"space": serial.SpaceParity,
	}
	par, ok := parityMap[strings.ToLower(parity)]
	if !ok {
		par = serial.NoParity
	}

	if dataBits == 0 {
		dataBits = 8
	}

	mode := &serial.Mode{
		BaudRate: baudRate,
		DataBits: dataBits,
		StopBits: sb,
		Parity:   par,
	}

	port, err := serial.Open(portName, mode)
	if err != nil {
		return fmt.Errorf("serial open %s: %w", portName, err)
	}

	sd := &SessionData{
		IsSerial:    true,
		SerialPort:  port,
		Stdin:       port,
		PromptReady: true,
	}

	// 重连复用同一 sessionId：覆盖会话映射。正常断开路径已由 disconnectAndNotify
	// 清理旧条目并关闭旧串口、退出旧读循环，因此这里直接覆盖即可。
	// Gen 在写 map 时分配新代次：旧读 goroutine 若仍存活，退出时会发现自己的
	// gen 已过时（map 里的会话是新一代），从而静默退出，不会误关新的 serial 会话。
	a.sshManager.mu.Lock()
	a.sshManager.nextGen++
	sd.Gen = a.sshManager.nextGen
	a.sshManager.sessions[sessionId] = sd
	a.sshManager.mu.Unlock()

	// Pipe output from serial port to frontend
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := port.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				a.WriteWsOutput(sessionId, data)
			}
			if err != nil {
				a.sshManager.disconnectCurrentGen(sessionId, sd.Gen)
				return
			}
		}
	}()

	return nil
}
