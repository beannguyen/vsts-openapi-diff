"use strict";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
var util = require("util");
// var fail = require("assert").fail;
var task = require("azure-pipelines-task-lib/task");
const fetch = require("node-fetch");


var swaggerVersion = task.getInput("swaggerVersion", true);

var leftType = task.getInput("leftType", true);
var rightType = task.getInput("rightType", true);

var leftPath = "",
    rightPath = "";

if (leftType === "file") {
    leftPath = task.getPathInput("leftFilePath", true, true);
} else {
    leftPath = task.getInput("leftUrl", true);
}

if (rightType === "file") {
    rightPath = task.getPathInput("rightFilePath", true, true);
} else {
    rightPath = task.getInput("rightUrl", true);
}

const webhookUrl = task.getInput("webhookUrl", true);

var config = null;

var extConfig = task.getInput("config", false);

function sendToWebhook(data) {
    fetch(webhookUrl, {
        method: 'post',
        body:    JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    })
    .then(res => res.json())
    .then(json => task.debug('Sent notification to webhook {0}. Response {1}'.format(webhookUrl, JSON.stringify(json))));
}

if (swaggerVersion == "v2") {
    var swaggerDiffLib = require("swagger-diff");

    if (extConfig && extConfig !== "") {
        config = JSON.parse(extConfig);
    } else {
        config = {
            changes: {
                breaks: 3,
                smooths: 2,
            },
        };
    }

    task.debug("Config: " + JSON.stringify(config));

    swaggerDiffLib(leftPath, rightPath, config).then(
        (diff) => {
            diff.errors.forEach((value) => {
                task.error(
                    util.format("Rule: %s, Message %s", value.ruleId, value.message)
                );
                task.debug("Error: " + JSON.stringify(value));
            });

            diff.warnings.forEach((value) => {
                task.warning(
                    util.format("Rule: %s, Message %s", value.ruleId, value.message)
                );
                task.debug("Warning: " + JSON.stringify(value));
            });

            diff.infos.forEach((value) => {
                console.log(
                    util.format("Rule: %s, Message %s", value.ruleId, value.message)
                );
                task.debug("Warning: " + JSON.stringify(value));
            });

            // Handle result
            task.debug(JSON.stringify(diff));

            if (diff.errors && diff.errors.length > 0) {
                
                sendToWebhook(diff);
            }


        },
        (reason) => {
            task.error(
                "An error occurred calling swagger-diff" + JSON.stringify(reason)
            );
            task.setResult(
                task.TaskResult.Failed,
                "An error occurred calling swagger-diff!"
            );
        }
    );
} else {
    (async () => {
        const openApiDiff = require("openapi-diff");
        const fs = require("fs");

        const readFile = util.promisify(fs.readFile);

        var leftContent = "",
            rightContent = "";
        if (leftType == "file") {
            leftContent = (await readFile(leftPath)).toString();
        } else {
            leftContent = await (await fetch(leftPath)).text();
        }

        if (rightType == "file") {
            rightContent = (await readFile(rightPath)).toString();
        } else {
            rightContent = await (await fetch(rightPath)).text();
        }

        const result = await openApiDiff.diffSpecs({
            sourceSpec: {
                content: leftContent,
                location: leftPath,
                format: "openapi3",
            },
            destinationSpec: {
                content: rightContent,
                location: rightPath,
                format: "openapi3",
            },
        });

        if (result.breakingDifferencesFound) {
            result.breakingDifferences.forEach((value) => {
                var spec = [];
                if (value.sourceSpecEntityDetails.length > 0)
                    spec = spec.concat(value.sourceSpecEntityDetails);
                if (value.destinationSpecEntityDetails.length > 0)
                    spec = spec.concat(value.destinationSpecEntityDetails);

                // console.log(
                //   util.format(
                //     "[%s change] Rule: %s, Path %s: %s",
                //     value.type,
                //     value.code,
                //     spec[0].location,
                //     value.action
                //   )
                // );
                task.warning(
                    util.format(
                        "[%s change] Rule: %s, Path %s %s",
                        value.type,
                        value.code,
                        value.action,
                        spec[0].location
                    )
                );
                task.debug("Error: " + JSON.stringify(value));
            });
        }

        result.nonBreakingDifferences.forEach((value) => {
            var spec = [];
            if (value.sourceSpecEntityDetails.length > 0)
                spec = spec.concat(value.sourceSpecEntityDetails);
            if (value.destinationSpecEntityDetails.length > 0)
                spec = spec.concat(value.destinationSpecEntityDetails);

            // console.log(
            //   util.format(
            //     "[%s change] Rule: %s, Path %s: %s",
            //     value.type,
            //     value.code,
            //     spec[0].location,
            //     value.action
            //   )
            // );
            task.warning(
                util.format(
                    "[%s change] Rule: %s, Path %s %s",
                    value.type,
                    value.code,
                    value.action,
                    spec[0].location
                )
            );
            task.debug("Warning: " + JSON.stringify(value));
        });

        result.unclassifiedDifferences.forEach((value) => {
            var spec = [];
            if (value.sourceSpecEntityDetails.length > 0)
                spec = spec.concat(value.sourceSpecEntityDetails);
            if (value.destinationSpecEntityDetails.length > 0)
                spec = spec.concat(value.destinationSpecEntityDetails);

            console.log(
                util.format(
                    "[%s change] Rule: %s, Path %s %s",
                    value.type,
                    value.code,
                    value.action,
                    spec[0].location
                )
            );

            task.debug("Unclassified: " + JSON.stringify(value));
        });

        // Handle result
        task.debug(JSON.stringify(result));

        if (result.breakingDifferencesFound) {
            sendToWebhook(result);
        }

        // we don't want to stop the pipeline if there are any breaking changes
        task.setResult(
            task.TaskResult.Succeeded,
            "There were 0 breaking differences found"
        );
    })().catch((e) => {
        if (e.code && e.code === "OPENAPI_DIFF_PARSE_ERROR") {
            task.error("Error parsing OpenAPI file: " + e.message);
        } else {
            task.error("An error occurred calling openapi-diff" + JSON.stringify(e));
        }
        task.setResult(
            task.TaskResult.Failed,
            "An error occurred calling openapi-diff!"
        );
    });
}
