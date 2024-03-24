import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";

let nodesReady: boolean[] = [];
let nodesReadyCount = 0;

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  let currentState: NodeState = {
    killed: false,
    x: "?",
    decided: null,
    k: 0,
  };
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());
  let receivedMessages: { [key: number]: Value | null } = {};

  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.get("/getMessage", (req, res) => {
    if (currentState.x !== null) {
      res.status(200).json({ value: currentState.x });
    } else {
      res.status(404).send("No value set for this node");
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  node.post("/message", async (req, res) => {
    const { nodeId, value } = req.body;

    // Vérifier si le nœud émetteur est défaillant
    if (isFaulty) {
      res.status(500).send("Faulty node");
      return;
    }

    // Stocker la valeur reçue du nœud nodeId
    receivedMessages[nodeId] = value;

    res.status(200).send("Message received");
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  // Route pour démarrer l'algorithme de consensus
  node.get("/start", async (req, res) => {
    while (!areAllNodesReady(N)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log("All nodes are ready");

    currentState.k = 0;

    // appliquer la valeur initiale au nœud
    if (isFaulty) {
      currentState.x = null;
      currentState.decided = null;
    } else {
      currentState.x = initialValue;
      currentState.decided = false;
    }

    // ben or
    while (!currentState.decided) {
      // diffuser la valeur actuelle à tous les autres nœuds
      await sendMessageToAllNodes(nodeId, currentState.x, N);

      // recevoir les messages de tous les autres nœuds
      const receivedValues: (Value | null)[] =
        await receiveMessagesFromAllNodes(nodeId, N);

      // calculer la majorité
      const majority = getMajorityValue(receivedValues);
      console.log("Received values", receivedValues);
      console.log("Majority", majority);

      // mettre à jour l'état
      if (majority !== "?") {
        currentState.x = majority;
        currentState.k++;
      }

      // vérifier si on a atteint le consensus
      const faultTolerance = F < N / 2 ? F : Math.floor(N / 2);
      if (currentState.k >= N - faultTolerance) {
        currentState.decided = true;
      }
    }

    res.status(200).send("Consensus reached");
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentState.killed = true;
    res.status(200).send("Node stopped");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.json({
        killed: currentState.killed,
        x: null,
        decided: null,
        k: null,
      });
    } else {
      res.json(currentState);
    }
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    // the node is ready
    setNodeIsReady(nodeId);
    nodesReady[nodeId] = true;
    nodesReadyCount++;
    if (isFaulty) {
      currentState.x = null;
      currentState.decided = null;
    } else {
      currentState.x = initialValue;
      currentState.decided = false;
    }
  });

  return server;
}

function areAllNodesReady(N: number): boolean {
  return nodesReadyCount === N && nodesReady.every((ready) => ready);
}

function getMajorityValue(values: (Value | null)[]): Value | "?" {
  const zeroCount = values.filter((value) => value === 0).length;
  const oneCount = values.filter((value) => value === 1).length;
  const unknownCount = values.filter((value) => value === null).length;

  if (zeroCount > oneCount && zeroCount > unknownCount) {
    return 0;
  } else if (oneCount > zeroCount && oneCount > unknownCount) {
    return 1;
  } else {
    return "?";
  }
}

async function sendMessageToAllNodes(
  nodeId: number,
  value: Value | null,
  N: number
) {
  if (value === null) {
    return;
  }

  const promises = [];
  for (let i = 0; i < N; i++) {
    if (i !== nodeId) {
      promises.push(
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nodeId, value }),
        })
      );
    }
  }
  await Promise.all(promises);
}

async function receiveMessagesFromAllNodes(
  nodeId: number,
  N: number
): Promise<(Value | null)[]> {
  const receivedValues: (Value | null)[] = new Array(N).fill(null);
  const promises = [];

  for (let i = 0; i < N; i++) {
    if (i !== nodeId) {
      promises.push(
        fetch(`http://localhost:${BASE_NODE_PORT + i}/getMessage`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          // Suppression du body pour les requêtes GET
        })
          .then((response) => response.json())
          .then((data) => {
            const { value } = data as { value: Value | null };
            receivedValues[i] = value;
          })
          .catch((error) => {
            console.error(`Error receiving message from node ${i}:`, error);
          })
      );
    }
  }

  await Promise.all(promises);
  return receivedValues;
}
