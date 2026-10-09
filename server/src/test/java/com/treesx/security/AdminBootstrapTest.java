package com.treesx.security;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class AdminBootstrapTest {
    @Test void normalRestartPreservesAnExistingAccount() {
        var admins=mock(AdministratorRepository.class); var encoder=mock(PasswordEncoder.class);
        when(admins.count()).thenReturn(1L);
        new AdminBootstrap(admins,encoder,"admin","123456",false).run(null);
        verifyNoInteractions(encoder); verify(admins,never()).deleteAllInBatch(); verify(admins,never()).save(any());
    }
    @Test void explicitResetReplacesOnlyTheSingleAdminAndHashesTheRequestedPassword() {
        var admins=mock(AdministratorRepository.class); var encoder=mock(PasswordEncoder.class);
        when(admins.count()).thenReturn(1L); when(encoder.encode("123456")).thenReturn("encoded-password");
        new AdminBootstrap(admins,encoder,"admin","123456",true).run(null);
        var saved=ArgumentCaptor.forClass(Administrator.class);
        verify(admins).deleteAllInBatch(); verify(admins).save(saved.capture());
        assertEquals("admin",saved.getValue().username); assertEquals("encoded-password",saved.getValue().passwordHash);
    }
    @Test void invalidPasswordDoesNotRemoveTheExistingAdmin() {
        var admins=mock(AdministratorRepository.class); var encoder=mock(PasswordEncoder.class);
        when(admins.count()).thenReturn(1L);
        assertThrows(IllegalStateException.class,()->new AdminBootstrap(admins,encoder,"admin","12345",true).run(null));
        verify(admins,never()).deleteAllInBatch(); verifyNoInteractions(encoder);
    }
}
