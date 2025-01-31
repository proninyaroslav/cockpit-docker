/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc and 2023 Jewish Education Media.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Terminal } from "xterm";
import { CanvasAddon } from 'xterm-addon-canvas';
import { ErrorNotification } from './Notification.jsx';

import * as client from './client.js';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

import "./ContainerTerminal.css";

const _ = cockpit.gettext;
const decoder = cockpit.utf8_decoder();
const encoder = cockpit.utf8_encoder();

function sequence_find(seq, find) {
    let f;
    const fl = find.length;
    let s;
    const sl = (seq.length - fl) + 1;
    for (s = 0; s < sl; s++) {
        for (f = 0; f < fl; f++) {
            if (seq[s + f] !== find[f])
                break;
        }
        if (f == fl)
            return s;
    }

    return -1;
}

class ContainerTerminal extends React.Component {
    constructor(props) {
        super(props);

        this.onChannelClose = this.onChannelClose.bind(this);
        this.onChannelMessage = this.onChannelMessage.bind(this);
        this.disconnectChannel = this.disconnectChannel.bind(this);
        this.connectChannel = this.connectChannel.bind(this);
        this.resize = this.resize.bind(this);
        this.connectToTty = this.connectToTty.bind(this);
        this.execAndConnect = this.execAndConnect.bind(this);
        this.setUpBuffer = this.setUpBuffer.bind(this);

        this.terminalRef = React.createRef();

        this.term = new Terminal({
            cols: 80,
            rows: 24,
            screenKeys: true,
            cursorBlink: true,
            fontSize: 12,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            screenReaderMode: true
        });

        this.state = {
            container: props.containerId,
            sessionId: props.containerId,
            channel: null,
            buffer: null,
            opened: false,
            errorMessage: "",
        };
    }

    componentDidMount() {
        this.connectChannel();
    }

    componentDidUpdate(prevProps, prevState) {
        // Connect channel when there is none and either container started or tty was resolved
        if (!this.state.channel && (
            (this.props.containerStatus === "running" && prevProps.containerStatus !== "running") ||
            (this.props.tty !== undefined && prevProps.tty === undefined)))
            this.connectChannel();
        if (prevProps.width !== this.props.width) {
            this.resize(this.props.width);
        }
    }

    resize(width) {
        // 24 PF padding * 4
        // 3 line border
        // 21 inner padding of xterm.js
        // xterm.js scrollbar 20
        const padding = 24 * 4 + 3 + 21 + 20;
        const realWidth = this.term._core._renderService.dimensions.css.cell.width;
        const cols = Math.floor((width - padding) / realWidth);
        this.term.resize(cols, 24);
        client.resizeContainersTTY(this.state.sessionId, this.props.tty, cols, 24)
                .catch(e => this.setState({ errorMessage: e.message }));
    }

    connectChannel() {
        if (this.state.channel)
            return;

        if (this.props.containerStatus !== "running")
            return;

        if (this.props.tty === undefined)
            return;

        if (this.props.tty)
            this.connectToTty();
        else
            this.execAndConnect();
    }

    setUpBuffer(channel) {
        const buffer = channel.buffer();

        // Parse the full HTTP response
        buffer.callback = (data) => {
            let ret = 0;
            let pos = 0;
            // let headers = "";

            // Double line break separates header from body
            pos = sequence_find(data, [13, 10, 13, 10]);
            if (pos == -1)
                return ret;

            if (data.subarray) {
                data = data.subarray(pos + 4);
                ret += pos + 4;
            } else {
                data = data.slice(pos + 4);
                ret += pos + 4;
            }
            // Set up callback for new incoming messages and if the first response
            // contained any body, pass it into the callback
            buffer.callback = this.onChannelMessage;
            const consumed = this.onChannelMessage(data);
            return ret + consumed;
        };

        channel.addEventListener('close', this.onChannelClose);

        // Show the terminal. Once it was shown, do not show it again but reuse the previous one
        if (!this.state.opened) {
            this.term.open(this.terminalRef.current);
            this.term.loadAddon(new CanvasAddon());
            this.setState({ opened: true });

            this.term.onData((data) => {
                if (this.state.channel)
                    this.state.channel.send(encoder.encode(data));
            });
        }
        channel.send(String.fromCharCode(12)); // Send SIGWINCH to show prompt on attaching

        return buffer;
    }

    execAndConnect() {
        client.execContainer(this.state.container)
                .then(r => {
                    const channel = cockpit.channel({
                        payload: "stream",
                        unix: client.getAddress(),
                        binary: true
                    });

                    const body = JSON.stringify({ Detach: false, Tty: false });
                    channel.send("POST " + client.VERSION + "/exec/" + encodeURIComponent(r.Id) +
                              "/start HTTP/1.0\r\n" +
                              "Content-Type: application/json; charset=utf-8\r\n" +
                              "Content-Length: " + body.length + "\r\n\r\n" + body);

                    const buffer = this.setUpBuffer(channel);
                    this.setState({ channel, errorMessage: "", buffer, sessionId: r.Id }, () => { console.log(this.props.width); this.resize(this.props.width) });
                })
                .catch(e => this.setState({ errorMessage: e.message }));
    }

    connectToTty() {
        const channel = cockpit.channel({
            payload: "stream",
            unix: client.getAddress(),
            binary: true
        });

        channel.send("POST " + client.VERSION + "/containers/" + encodeURIComponent(this.state.container) +
                      "/attach?stdin=true&stdout=true&stderr=true&stream=true HTTP/1.0\r\n" +
                      "Upgrade: tcp\r\nConnection: Upgrade\r\n\r\n");

        const buffer = this.setUpBuffer(channel);
        this.setState({ channel, errorMessage: "", buffer });
        this.resize(this.props.width);
    }

    componentWillUnmount() {
        this.disconnectChannel();
        if (this.state.channel)
            this.state.channel.close();
        this.term.dispose();
    }

    onChannelMessage(buffer) {
        if (buffer)
            this.term.write(decoder.decode(buffer));
        return buffer.length;
    }

    onChannelClose(event, options) {
        this.term.write('\x1b[31m disconnected \x1b[m\r\n');
        this.disconnectChannel();
        this.setState({ channel: null });
        this.term.cursorHidden = true;
    }

    disconnectChannel() {
        if (this.state.buffer)
            this.state.buffer.callback = null; // eslint-disable-line react/no-direct-mutation-state
        if (this.state.channel) {
            this.state.channel.removeEventListener('close', this.onChannelClose);
        }
    }

    render() {
        let element = <div className="container-terminal" ref={this.terminalRef} />;

        if (this.props.containerStatus !== "running" && !this.state.opened)
            element = <EmptyStatePanel title={_("Container is not running")} />;

        return (
            <>
                {this.state.errorMessage && <ErrorNotification errorMessage={_("Error occurred while connecting console")} errorDetail={this.state.errorMessage} onDismiss={() => this.setState({ errorMessage: "" })} />}
                {element}
            </>
        );
    }
}

ContainerTerminal.propTypes = {
    containerId: PropTypes.string.isRequired,
    containerStatus: PropTypes.string.isRequired,
    width: PropTypes.number.isRequired,
    tty: PropTypes.bool,
};

export default ContainerTerminal;
