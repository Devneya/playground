import {ChatCompletionMessageParam} from "openai/resources";
import {singleAgentRequest, singleRequestProps} from "./singleAgentRequest";
import {
  buildSystemPromptForSupervisor,
  generateSequentialAgentSystemPrompt,
  generateSequentialAggregatorPrompt,
} from "./systemPrompts";
import {MoARequestProps} from "./MoARequest";

function parseResponseText(responseText: string) {
  const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
  const answerMatch = responseText.match(/<answer>([\s\S]*?)<\/answer>/);
  return {
    thinking: thinkMatch ? thinkMatch[1].trim() : "",
    answer: answerMatch ? answerMatch[1].trim() : responseText,
  };
}

const buildSequentialContext = (
  userPrompt: string,
  responses: { role: string; response: string }[]
): ChatCompletionMessageParam[] => {
  const context: ChatCompletionMessageParam[] = [
    {role: "user", content: userPrompt},
  ];

  responses.forEach(({role, response}, index) => {
    context.push({
      role: "assistant",
      content: `${role} - Agent ${index + 1}: ${response}`,
    });
  });
  return context;
};

export const parseSupervisorResponse = (
  supervisorOutput: string
): Record<string, string> => {
  const rolePromptPairs: Record<string, string> = {};
  const lines = supervisorOutput.split("\n").filter(Boolean);
  for (const line of lines) {
    const [role, ...promptParts] = line.split(":");
    if (role && promptParts.length > 0) {
      const trimmedRole = role.trim();
      const prompt = promptParts.join(":").trim();
      if (trimmedRole && prompt) {
        rolePromptPairs[trimmedRole] = prompt;
      }
    }
  }
  return rolePromptPairs;
};

export const supervisorRequest = (props: {
  promptNodeData: singleRequestProps["promptNodeData"];
  promptNodeContext: ChatCompletionMessageParam[];
  virtualKey: string;
  selectedRoles: string[];
}): Promise<string> => {
  const systemPrompt = buildSystemPromptForSupervisor();
  const rolesInstruction: ChatCompletionMessageParam = {
    role: "user",
    content: `Here are the roles assigned for this task: ${props.selectedRoles.join(
      ", "
    )}.\nPlease provide system prompts for each.`,
  };
  const promptNodeContextWithRoles = [
    ...props.promptNodeContext,
    rolesInstruction,
  ];

  return singleAgentRequest({
    promptNodeData: {
      ...props.promptNodeData,
      prompt: props.promptNodeData.prompt,
      selectedModels: [{
        ...(props.promptNodeData.selectedModels?.[0] ?? {}),
        params: props.promptNodeData.selectedModels?.[0]?.params || "{}",
      }],
    },
    promptNodeContext: promptNodeContextWithRoles,
    virtualKey: props.virtualKey,
    areThoughtsShown: false,
    systemPrompt,
  }).then((response: { choices: { message: { content: any } }[] }) => {
    return response.choices?.[0]?.message?.content ?? "";
  });
};

export const MoASequentialRequestWithRoles = (
  props: MoARequestProps & {
    requestData: singleRequestProps;
    allRoles: string[];
  }
): Promise<any> => {
  return supervisorRequest({
    promptNodeData: props.requestData.promptNodeData,
    promptNodeContext: props.requestData.promptNodeContext,
    virtualKey: props.requestData.virtualKey,
    selectedRoles: props.allRoles,
  }).then((r) => {
    const roleToSystemPrompt = parseSupervisorResponse(r);
    return MoASequentialRequest({
      ...props.requestData,
      proposersDataAndContext: props.proposersDataAndContext!,
      addContentNode: props.addContentNode,
      getContentNodePosition: props.getContentNodePosition!,
      getProposerSize: props.getProposerSize,
      changeNodeExecutionStatus: props.changeNodeExecutionStatus,
      addContentNodeToContainer: props.addContentNodeToContainer!,
      roleToSystemPrompt: roleToSystemPrompt,
      hasNonAssistantRole: true,
    });
  });
};

export const MoASequentialRequest = (
  props: MoARequestProps & {
    roleToSystemPrompt?: Record<string, string>;
    hasNonAssistantRole?: boolean;
  }
): Promise<any> => {
  let chain = Promise.resolve();
  const accumulatedResponses: string[] = [];
  const accumulatedResponsesWithRoles: { role: string; response: string }[] =
    [];
  let count = 0;

  props.proposersDataAndContext.forEach(([data, id, context], index) => {
    chain = chain.then(() => {
      props.changeNodeExecutionStatus(id, true);

      const prompt = props.hasNonAssistantRole
        ? data.role && props.roleToSystemPrompt
          ? props.roleToSystemPrompt[data.role]
          : props.promptNodeData.prompt
        : props.promptNodeData.prompt;
      const node = props.addContentNode(
        props.getContentNodePosition(id),
        {
          parentId: id,
          prompt: prompt,
          responsePromise: singleAgentRequest({
            promptNodeData: {
              ...data,
              prompt: prompt,
              selectedModels: [{
                ...(props.promptNodeData.selectedModels?.[0] ?? {}),
                params: props.promptNodeData.selectedModels?.[0]?.params || "{}",
              }],
            },
            promptNodeContext: buildSequentialContext(
              props.promptNodeData.prompt,
              accumulatedResponsesWithRoles
            ),
            virtualKey: props.virtualKey,
            areThoughtsShown: true,
            systemPrompt: generateSequentialAgentSystemPrompt(
              count,
              props.roleToSystemPrompt?.[data.role ?? ""],
              data.role
            ),
          }),
          response: undefined,
          isRegenerated: false,
          areThoughtsShown: true,
          isHidden: false,
          isContained: true,
          MoAContainerId: data.MoAContainerId,
          previousAgentResponse:
            accumulatedResponses[accumulatedResponses.length - 1] ?? undefined,
        },
        props.getProposerSize(id)
      );
      return node?.data?.responsePromise?.then((res: any) => {
        const content = res.choices?.[0]?.message?.content ?? "";
        const answer = parseResponseText(content).answer;
        accumulatedResponsesWithRoles.push({
          role: data.role ?? "assistant",
          response: answer,
        });
        accumulatedResponses.push(answer);
        count = count + 1;
      });
    });
  });

  return chain.then(() => {
    const systemPrompt = generateSequentialAggregatorPrompt(
      props.promptNodeData.prompt,
      accumulatedResponsesWithRoles,
      props.hasNonAssistantRole
    );
    const promptNodeContext = buildSequentialContext(
      props.promptNodeData.prompt,
      accumulatedResponsesWithRoles
    );
    return singleAgentRequest({...props, promptNodeContext, systemPrompt});
  });
};
