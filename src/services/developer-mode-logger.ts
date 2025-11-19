import { supabase } from '../lib/supabase';

interface DeveloperModeSettings {
  enabled: boolean;
  log_all_layers: boolean;
  log_avoid_patterns: boolean;
  log_continuous_learning: boolean;
  log_smart_goal_llm: boolean;
  log_to_console: boolean;
  log_to_database: boolean;
}

class DeveloperModeLogger {
  private settings: DeveloperModeSettings | null = null;
  private userId: string | null = null;

  async initialize(userId: string): Promise<void> {
    this.userId = userId;
    await this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    if (!this.userId) return;

    try {
      const { data } = await supabase
        .from('developer_mode_settings')
        .select('*')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (data) {
        this.settings = data;
      } else {
        this.settings = {
          enabled: false,
          log_all_layers: true,
          log_avoid_patterns: true,
          log_continuous_learning: true,
          log_smart_goal_llm: true,
          log_to_console: true,
          log_to_database: true
        };
      }
    } catch (error) {
      console.error('[Dev Mode] Error loading settings:', error);
      this.settings = null;
    }
  }

  isEnabled(): boolean {
    return this.settings?.enabled ?? false;
  }

  async logLayerDecision(
    sessionId: string | null,
    symbol: string,
    layerNumber: number,
    layerName: string,
    decision: string,
    output: any,
    processingTimeMs: number,
    tokensUsed: number,
    passedToNextLayer: boolean
  ): Promise<void> {
    if (!this.isEnabled() || !this.settings?.log_all_layers) return;
    if (!this.userId) return;

    const logData = {
      layer: layerNumber,
      name: layerName,
      symbol,
      decision,
      passedToNext: passedToNextLayer,
      timeMs: processingTimeMs,
      tokens: tokensUsed
    };

    if (this.settings.log_to_console) {
      console.log(`[Dev Mode - Layer ${layerNumber}]`, logData);
    }

    if (this.settings.log_to_database) {
      try {
        await supabase.from('llm_layer_decision_log').insert({
          user_id: this.userId,
          session_id: sessionId,
          symbol,
          layer_number: layerNumber,
          layer_name: layerName,
          layer_decision: decision,
          layer_output: output,
          processing_time_ms: processingTimeMs,
          tokens_used: tokensUsed,
          passed_to_next_layer: passedToNextLayer
        });
      } catch (error) {
        console.error('[Dev Mode] Error logging layer decision:', error);
      }
    }
  }

  async logAvoidPatternEvent(
    symbol: string,
    triggerType: string,
    wasBlocked: boolean,
    reason: string | null,
    matchedPatterns: any[]
  ): Promise<void> {
    if (!this.isEnabled() || !this.settings?.log_avoid_patterns) return;

    const logData = {
      symbol,
      trigger: triggerType,
      blocked: wasBlocked,
      reason,
      patterns: matchedPatterns.length
    };

    if (this.settings.log_to_console) {
      console.log('[Dev Mode - Avoid Pattern]', logData);
    }
  }

  async logContinuousLearningEvent(
    event: string,
    details: any
  ): Promise<void> {
    if (!this.isEnabled() || !this.settings?.log_continuous_learning) return;

    if (this.settings.log_to_console) {
      console.log('[Dev Mode - Continuous Learning]', event, details);
    }
  }

  async logSmartGoalLLMUsage(
    symbol: string,
    llmUsed: boolean,
    decision: string
  ): Promise<void> {
    if (!this.isEnabled() || !this.settings?.log_smart_goal_llm) return;

    const logData = {
      symbol,
      llmUsed,
      decision
    };

    if (this.settings.log_to_console) {
      console.log('[Dev Mode - Smart Goal LLM]', logData);
    }
  }

  async logPipelineExecution(
    sessionId: string | null,
    symbol: string,
    triggerType: string,
    pipelineData: {
      hardGateResult: string;
      layer1Passed: boolean;
      layer2Passed: boolean;
      layer3Passed: boolean;
      layer4Completed: boolean;
      layer5Executed: boolean;
      finalDecision: string;
      finalConfidence: number | null;
      calibratedConfidence: number | null;
      totalProcessingTimeMs: number;
      totalTokensUsed: number;
      layersExecuted: number;
      abortLayer: number | null;
      abortReason: string | null;
    }
  ): Promise<void> {
    if (!this.isEnabled()) return;
    if (!this.userId) return;

    if (this.settings?.log_to_console) {
      console.log('[Dev Mode - Pipeline Complete]', {
        symbol,
        trigger: triggerType,
        decision: pipelineData.finalDecision,
        layers: pipelineData.layersExecuted,
        timeMs: pipelineData.totalProcessingTimeMs
      });
    }

    if (this.settings?.log_to_database) {
      try {
        await supabase.from('llm_pipeline_execution_log').insert({
          user_id: this.userId,
          session_id: sessionId,
          symbol,
          trigger_type: triggerType,
          hard_gate_result: pipelineData.hardGateResult,
          layer_1_passed: pipelineData.layer1Passed,
          layer_2_passed: pipelineData.layer2Passed,
          layer_3_passed: pipelineData.layer3Passed,
          layer_4_completed: pipelineData.layer4Completed,
          layer_5_executed: pipelineData.layer5Executed,
          final_decision: pipelineData.finalDecision,
          final_confidence: pipelineData.finalConfidence,
          calibrated_confidence: pipelineData.calibratedConfidence,
          total_processing_time_ms: pipelineData.totalProcessingTimeMs,
          total_tokens_used: pipelineData.totalTokensUsed,
          layers_executed: pipelineData.layersExecuted,
          abort_layer: pipelineData.abortLayer,
          abort_reason: pipelineData.abortReason
        });
      } catch (error) {
        console.error('[Dev Mode] Error logging pipeline execution:', error);
      }
    }
  }

  async enableDeveloperMode(enable: boolean): Promise<void> {
    if (!this.userId) return;

    try {
      await supabase
        .from('developer_mode_settings')
        .upsert({
          user_id: this.userId,
          enabled: enable,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      await this.loadSettings();
      console.log(`[Dev Mode] ${enable ? 'ENABLED' : 'DISABLED'}`);
    } catch (error) {
      console.error('[Dev Mode] Error updating settings:', error);
    }
  }
}

export const developerModeLogger = new DeveloperModeLogger();
