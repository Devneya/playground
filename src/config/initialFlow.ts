import {FlowSnapshot} from "../logic/flowSnapshot";

export const initialFlow: FlowSnapshot = {
  nodes: [
    {
      id: "randomnode_initial_mdn0wjf8888v2z6kjf8",
      type: "prompt",
      data: {
        isExecuted: false,
        prompt: "",
        selectedModels: [
          {
            type: "text",
            name: "gemma-3n-E4B-it",
            params: "{\n\n\n\n\n\n\n\n\n}",
          }
        ],
        recentModelsList: [
          {
            value: "gemma-3n-E4B-it",
            priority: 0,
          },
        ],
        areThoughtsShown: false,
      },
      position: {x: 1000, y: 500},
      width: 600,
      height: 250,
      style: {
        width: 600,
        height: 250,
      },
    },
  ],
  edges: [],
  viewport: {
    x: 0,
    y: 0,
    zoom: 0.9,
  },
};
