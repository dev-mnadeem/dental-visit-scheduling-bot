"""
Tests for Appointment Flow
"""
import os
import tempfile
import pytest
from unittest.mock import MagicMock, AsyncMock, patch


@pytest.fixture(autouse=True)
def set_env():
    """Set test environment."""
    os.environ["OPENAI_API_KEY"] = "test-key"
    os.environ["LLM_PROVIDER"] = "openai"


@pytest.fixture
def mock_llm_provider():
    """Create mock LLM provider."""
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test", "LLM_PROVIDER": "openai"}):
        from llm.provider import LLMProvider
        provider = MagicMock(spec=LLMProvider)
        provider.get_model.return_value = MagicMock()
        return provider


@pytest.fixture
def state_manager():
    """Create state manager without memory."""
    from conversation.state_manager import ConversationStateManager
    return ConversationStateManager(conversation_memory=None)


@pytest.fixture
def temp_storage():
    """Create temp storage."""
    with tempfile.TemporaryDirectory() as tmp:
        from storage.appointment_store import AppointmentStore
        from storage.log_store import LogStore
        apt_store = AppointmentStore(data_dir=tmp)
        log_store = LogStore(data_dir=tmp)
        yield apt_store, log_store


@pytest.fixture
def appointment_flow(mock_llm_provider, state_manager, temp_storage):
    """Create appointment flow with mocks."""
    apt_store, log_store = temp_storage
    from flows.appointment_flow import AppointmentFlow, AppointmentExtraction

    # Mock extraction to return structured data
    mock_extraction = MagicMock(return_value=AppointmentExtraction(
        date="2024-03-15",
        time="10:00:00",
        service_type="Consultation",
        intent="book_appointment",
    ))

    flow = AppointmentFlow(
        llm_provider=mock_llm_provider,
        state_manager=state_manager,
        appointment_store=apt_store,
        log_store=log_store,
    )

    # Patch the extraction chain
    flow._extract_with_llm = AsyncMock(return_value=AppointmentExtraction(
        date="2024-03-15",
        time="10:00:00",
        service_type="Consultation",
        intent="book_appointment",
    ))
    flow._generate_response_with_llm = AsyncMock(return_value="What date would you like?")

    return flow


class TestAppointmentFlow:
    """Tests for AppointmentFlow."""

    def test_normalize_date(self, appointment_flow):
        """Test date normalization."""
        from datetime import datetime
        from utils.clock import business_now
        today_str = business_now().strftime("%Y-%m-%d")
        assert appointment_flow._normalize_date("today") == today_str
        assert appointment_flow._normalize_date("2024-03-15") == "2024-03-15"

    def test_normalize_time(self, appointment_flow):
        """Test time normalization."""
        assert appointment_flow._normalize_time("10:30") == "10:30:00"
        assert appointment_flow._normalize_time("2:00 pm") == "14:00:00"

    @pytest.mark.asyncio
    async def test_process_message_collects_data(self, appointment_flow, state_manager):
        """Test that process_message collects appointment data."""
        state = state_manager.get_state("test-session")
        # Set extraction to return all fields
        appointment_flow._extract_with_llm = AsyncMock(return_value=MagicMock(
            date="2024-03-15",
            time="10:00:00",
            service_type="Consultation",
            intent="book_appointment",
        ))
        from flows.appointment_flow import AppointmentExtraction
        appointment_flow._extract_with_llm.return_value = AppointmentExtraction(
            date="2024-03-15",
            time="10:00:00",
            service_type="Consultation",
            intent="book_appointment",
        )

        with patch("flows.appointment_flow.check_availability", AsyncMock(return_value=True)):
            response, metadata = await appointment_flow.process_message(
                "test-session",
                "I want to book for March 15 at 10am for a consultation",
                state,
                user_id=1,
            )
        assert "date" in state["appointment_data"]
        assert "time" in state["appointment_data"]
        assert "service_type" in state["appointment_data"]
        assert metadata.get("status") in ("collecting_info", "ready_to_book", "booked")


@pytest.mark.asyncio
async def test_confirmation_failure_never_claims_a_booking(appointment_flow, state_manager):
    state = state_manager.get_state("failed-booking")
    state["appointment_data"] = {"date": "2098-01-10", "time": "10:00:00", "service_type": "Consultation"}
    appointment_flow.backend_client.create_appointment = AsyncMock(return_value=None)
    appointment_flow.appointment_store.save = MagicMock()
    response, metadata = await appointment_flow._handle_confirmation("failed-booking", state, 1)
    assert metadata["status"] == "booking_failed"
    assert "appointment_id" not in metadata
    assert "No confirmation was issued" in response
    appointment_flow.appointment_store.save.assert_not_called()


@pytest.mark.asyncio
async def test_confirmation_uses_backend_id_and_keeps_retry_key(appointment_flow, state_manager):
    state = state_manager.get_state("retry-booking")
    state["appointment_data"] = {"date": "2098-01-10", "time": "10:00:00", "service_type": "Consultation"}
    appointment_flow.backend_client.create_appointment = AsyncMock(return_value={"id": 42})
    appointment_flow.appointment_store.save = MagicMock()
    for _ in range(2):
        response, metadata = await appointment_flow._handle_confirmation("retry-booking", state, 1)
        assert metadata["appointment_id"] == 42
        assert "Confirmation ID: 42" in response
    calls = appointment_flow.backend_client.create_appointment.call_args_list
    assert calls[0].args[0]["booking_request_id"] == calls[1].args[0]["booking_request_id"]
    state["appointment_data"]["time"] = "12:00:00"
    await appointment_flow._handle_confirmation("retry-booking", state, 1)
    assert calls[0].args[0]["booking_request_id"] != appointment_flow.backend_client.create_appointment.call_args.args[0]["booking_request_id"]
    appointment_flow.appointment_store.save.assert_not_called()
