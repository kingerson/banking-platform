import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from '../services/ai.service';
import { createLLMProvider } from '../providers/llm.provider';

@Module({
  controllers: [AIController],
  providers: [
    {
      provide: 'LLM_PROVIDER',
      useFactory: () => createLLMProvider(),
    },
    AIService,
  ],
  exports: [AIService, 'LLM_PROVIDER'],
})
export class AIModule {}
