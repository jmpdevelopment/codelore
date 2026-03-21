import * as vscode from 'vscode';

export interface LmResult {
  text: string;
  modelName: string;
}

export class LmService {
  private selectedModelId: string | undefined;

  async getModel(): Promise<vscode.LanguageModelChat | undefined> {
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      vscode.window.showWarningMessage(
        'CodeDiary: No language model available. Install GitHub Copilot or another LM extension.',
      );
      return undefined;
    }

    // If we previously selected a model and it's still available, reuse it
    if (this.selectedModelId) {
      const found = models.find(m => m.id === this.selectedModelId);
      if (found) { return found; }
    }

    // If only one model, use it
    if (models.length === 1) {
      this.selectedModelId = models[0].id;
      return models[0];
    }

    // Multiple models — let the user choose
    const items = models.map(m => ({
      label: `${m.vendor}/${m.family}`,
      description: m.id,
      detail: `Max tokens: ${m.maxInputTokens}`,
      model: m,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select which language model CodeDiary should use',
      title: 'CodeDiary: Choose AI Model',
    });

    if (!picked) { return undefined; }

    this.selectedModelId = picked.model.id;
    return picked.model;
  }

  async changeModel(): Promise<void> {
    this.selectedModelId = undefined;
    const model = await this.getModel();
    if (model) {
      vscode.window.showInformationMessage(
        `CodeDiary: Now using ${model.vendor}/${model.family}`,
      );
    }
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    token: vscode.CancellationToken,
  ): Promise<LmResult | undefined> {
    const model = await this.getModel();
    if (!model) { return undefined; }

    const modelName = `${model.vendor}/${model.family}`;

    const messages = [
      vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userPrompt}`),
    ];

    try {
      const response = await model.sendRequest(messages, {}, token);
      let result = '';
      for await (const chunk of response.text) {
        result += chunk;
      }
      return { text: result.trim(), modelName };
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        vscode.window.showErrorMessage(`CodeDiary AI: ${err.message}`);
      }
      return undefined;
    }
  }
}
