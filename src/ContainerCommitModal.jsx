import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput";
import cockpit from 'cockpit';

import { FormHelper } from 'cockpit-components-form-helper.jsx';
import * as utils from './util.js';
import * as client from './client.js';
import { ErrorNotification } from './Notification.jsx';
import { fmt_to_fragments } from 'utils.jsx';
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

const ContainerCommitModal = ({ container, localImages }) => {
    const Dialogs = useDialogs();

    const [imageName, setImageName] = useState("");
    const [tag, setTag] = useState("");
    const [author, setAuthor] = useState("");
    const [command, setCommand] = useState(utils.quote_cmdline(container.Config.Cmd));
    const [pause, setPause] = useState(false);

    const [dialogError, setDialogError] = useState("");
    const [dialogErrorDetail, setDialogErrorDetail] = useState("");
    const [commitInProgress, setCommitInProgress] = useState(false);
    const [nameError, setNameError] = useState("");

    const handleCommit = (force) => {
        if (!force && !imageName) {
            setNameError(_("Image name is required"));
            return;
        }

        let full_name = imageName + ":" + (tag !== "" ? tag : "latest");
        if (full_name.indexOf("/") < 0)
            full_name = "localhost/" + full_name;

        if (!force && localImages.some(image => image.Name === full_name)) {
            setNameError(_("Image name is not unique"));
            return;
        }

        function quote(word) {
            word = word.replace(/"/g, '\\"');
            return '"' + word + '"';
        }

        const commitData = {};
        commitData.container = container.Id;
        commitData.repo = imageName;
        commitData.author = author;
        commitData.pause = pause;
        commitData.format = 'docker';

        if (tag)
            commitData.tag = tag;

        commitData.changes = [];
        if (command.trim() !== "") {
            let cmdData = "";
            const words = utils.unquote_cmdline(command.trim());
            const cmdStr = words.map(quote).join(", ");
            cmdData = "CMD [" + cmdStr + "]";
            commitData.changes.push(cmdData);
        }

        setCommitInProgress(true);
        setNameError("");
        setDialogError("");
        setDialogErrorDetail("");
        client.commitContainer(commitData)
                .then(() => Dialogs.close())
                .catch(ex => {
                    setDialogError(cockpit.format(_("Failed to commit container $0"), container.Name));
                    setDialogErrorDetail(cockpit.format("$0: $1", ex.message, ex.reason));
                    setCommitInProgress(false);
                });
    };

    const commitContent = (
        <Form isHorizontal>
            {dialogError && <ErrorNotification errorMessage={dialogError} errorDetail={dialogErrorDetail} onDismiss={() => setDialogError("")} />}
            <FormGroup fieldId="commit-dialog-image-name" label={_("New image name")}>
                <TextInput id="commit-dialog-image-name"
                           value={imageName}
                           validated={nameError ? "error" : "default"}
                           onChange={(_, value) => { setNameError(""); setImageName(value) }} />
                <FormHelper fieldId="commit-dialog-image-name" helperTextInvalid={nameError} />
            </FormGroup>

            <FormGroup fieldId="commit-dialog-image-tag" label={_("Tag")}>
                <TextInput id="commit-dialog-image-tag"
                           placeholder="latest" // Do not translate
                           value={tag}
                           onChange={(_, value) => { setNameError(""); setTag(value) }} />
            </FormGroup>

            <FormGroup fieldId="commit-dialog-author" label={_("Author")}>
                <TextInput id="commit-dialog-author"
                           placeholder={_("Example, Your Name <yourname@example.com>")}
                           value={author}
                           onChange={(_, value) => setAuthor(value)} />
            </FormGroup>

            <FormGroup fieldId="commit-dialog-command" label={_("Command")}>
                <TextInput id="commit-dialog-command"
                           value={command}
                           onChange={(_, value) => setCommand(value)} />
            </FormGroup>

            <FormGroup fieldId="commit-dialog-pause" label={_("Options")} isStack hasNoPaddingTop>
                <Checkbox id="commit-dialog-pause"
                          isChecked={pause}
                          onChange={(_, val) => setPause(val)}
                          label={_("Pause container when creating image")} />
            </FormGroup>
        </Form>
    );

    return (
        <Modal isOpen
                 showClose={false}
                 position="top" variant="medium"
                 title={_("Commit container")}
                 description={fmt_to_fragments(_("Create a new image based on the current state of the $0 container."), <b>{container.Name}</b>)}
                 footer={<>
                     <Button variant="primary"
                             className="btn-ctr-commit"
                             isLoading={commitInProgress && !nameError}
                             isDisabled={commitInProgress || nameError}
                             onClick={() => handleCommit(false)}>
                         {_("Commit")}
                     </Button>
                     {nameError && <Button variant="warning"
                             className="btn-ctr-commit-force"
                             isLoading={commitInProgress}
                             isDisabled={commitInProgress}
                             onClick={() => handleCommit(true)}>
                         {_("Force commit")}
                     </Button>}
                     <Button variant="link"
                             className="btn-ctr-cancel-commit"
                             isDisabled={commitInProgress}
                             onClick={Dialogs.close}>
                         {_("Cancel")}
                     </Button>
                 </>}
        >
            {commitContent}
        </Modal>
    );
};

export default ContainerCommitModal;
