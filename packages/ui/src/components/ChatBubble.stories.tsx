import type { Meta, StoryObj } from '@storybook/react';
import { ChatBubble } from './ChatBubble';

const meta: Meta<typeof ChatBubble> = {
  title: 'Components/ChatBubble',
  component: ChatBubble,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatBubble>;

export const OwnMessage: Story = {
  args: {
    position: 'end',
    timestamp: '2:34 PM',
    children: 'Hey, are you going to the meetup tonight?',
  },
};

export const OtherMessage: Story = {
  args: {
    position: 'start',
    timestamp: '2:35 PM',
    children: "Yeah! I'll be there around 7. Want to grab food first?",
  },
};

export const Pending: Story = {
  args: {
    position: 'end',
    pending: true,
    children: 'Sending this message...',
  },
};

export const LongMessage: Story = {
  args: {
    position: 'start',
    timestamp: '2:36 PM',
    children:
      'This is a much longer message to test how the bubble handles word wrapping and text overflow. It should break nicely within the max-width constraint and still look good.',
  },
};

export const Conversation: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: 400 }}>
      <ChatBubble position="start" timestamp="2:30 PM">
        yo, you online?
      </ChatBubble>
      <ChatBubble position="end" timestamp="2:31 PM">
        yep whats up
      </ChatBubble>
      <ChatBubble position="start" timestamp="2:31 PM">
        check out this room i made, its for the atproto hackathon
      </ChatBubble>
      <ChatBubble position="end" timestamp="2:32 PM">
        oh sick, joining now
      </ChatBubble>
      <ChatBubble position="end" pending>
        sending...
      </ChatBubble>
    </div>
  ),
};
